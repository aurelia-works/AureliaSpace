//! Natural language -> shell command. Free backends only: local Ollama (default) or
//! free-tier Gemini / OpenRouter with the API key kept in the macOS Keychain.
//! The result is only ever displayed / inserted by the frontend, never executed.

use crate::config::{self, ProviderConfig, SuggestionsConfig};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

const KEYCHAIN_SERVICE: &str = "AureliaSpace";

const SYSTEM_PROMPT: &str = "You translate a request into exactly one shell command for zsh on macOS. \
Reply with only the command on a single line: no explanation, no markdown, no code fences. \
Prefer safe, non-destructive commands and standard macOS/BSD tool flags.";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestRequest {
    pub prompt: String,
    pub cwd: Option<String>,
    #[serde(default)]
    pub recent_commands: Vec<String>,
    /// Only present when the user opted in to sending the last command's output.
    pub last_output: Option<String>,
}

fn key_entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, &format!("{provider}-api-key")).map_err(|e| e.to_string())
}

fn api_key(provider: &str) -> Result<String, String> {
    key_entry(provider)?
        .get_password()
        .map_err(|_| format!("No {provider} API key saved. Add one in Settings (⌘,)."))
}

fn user_message(req: &SuggestRequest) -> String {
    let mut msg = String::new();
    if let Some(cwd) = &req.cwd {
        msg.push_str(&format!("cwd: {cwd}\n"));
    }
    msg.push_str("shell: zsh (macOS)\n");
    if !req.recent_commands.is_empty() {
        msg.push_str("recent commands:\n");
        for c in &req.recent_commands {
            msg.push_str(&format!("  {c}\n"));
        }
    }
    if let Some(out) = &req.last_output {
        // Keep the tail; it's the most relevant part.
        let tail: String = out.chars().rev().take(4000).collect::<Vec<_>>().into_iter().rev().collect();
        msg.push_str(&format!("last command output:\n{tail}\n"));
    }
    msg.push_str(&format!("request: {}", req.prompt.trim()));
    msg
}

fn clean(raw: &str) -> String {
    let mut text = raw.trim();
    if let Some(rest) = text.strip_prefix("```") {
        // Drop an optional language tag on the fence line.
        text = rest.split_once('\n').map(|(_, body)| body).unwrap_or(rest);
        text = text.trim_end().trim_end_matches("```");
    }
    let text = text.trim().trim_matches('`').trim();
    text.strip_prefix("$ ").unwrap_or(text).trim().to_string()
}

fn base<'a>(p: &'a ProviderConfig, fallback: &'a str) -> &'a str {
    let b = if p.base_url.is_empty() { fallback } else { p.base_url.as_str() };
    b.trim_end_matches('/')
}

fn model<'a>(p: &'a ProviderConfig, fallback: &'a str) -> &'a str {
    if p.model.is_empty() { fallback } else { p.model.as_str() }
}

async fn post(req: reqwest::RequestBuilder, body: Value) -> Result<Value, String> {
    let resp = req.json(&body).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let value: Value = resp.json().await.map_err(|e| format!("bad response ({status}): {e}"))?;
    if !status.is_success() {
        let detail = value
            .pointer("/error/message")
            .or_else(|| value.pointer("/error"))
            .map(|v| v.as_str().map(String::from).unwrap_or_else(|| v.to_string()))
            .unwrap_or_else(|| value.to_string());
        return Err(format!("{status}: {detail}"));
    }
    Ok(value)
}

async fn run(cfg: &SuggestionsConfig, req: &SuggestRequest) -> Result<String, String> {
    let defaults = SuggestionsConfig::default();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let user = user_message(req);

    let text = match cfg.provider.as_str() {
        "ollama" => {
            let url = format!("{}/api/chat", base(&cfg.ollama, &defaults.ollama.base_url));
            let m = model(&cfg.ollama, &defaults.ollama.model);
            let body = json!({
                "model": m,
                "stream": false,
                "options": { "temperature": 0.1 },
                "messages": [
                    { "role": "system", "content": SYSTEM_PROMPT },
                    { "role": "user", "content": user }
                ]
            });
            let v = post(client.post(&url), body).await.map_err(|e| {
                if e.contains("error sending request") || e.contains("onnect") {
                    format!("Ollama isn't reachable at {}. Install it (`brew install ollama`), run `ollama serve`, then `ollama pull {m}`.", base(&cfg.ollama, &defaults.ollama.base_url))
                } else if e.contains("not found") {
                    format!("Model '{m}' isn't pulled. Run `ollama pull {m}`.")
                } else {
                    e
                }
            })?;
            v.pointer("/message/content").and_then(Value::as_str).unwrap_or_default().to_string()
        }
        "gemini" => {
            let key = api_key("gemini")?;
            let url = format!(
                "{}/models/{}:generateContent",
                base(&cfg.gemini, &defaults.gemini.base_url),
                model(&cfg.gemini, &defaults.gemini.model)
            );
            let body = json!({
                "systemInstruction": { "parts": [{ "text": SYSTEM_PROMPT }] },
                "contents": [{ "role": "user", "parts": [{ "text": user }] }],
                "generationConfig": { "temperature": 0.1 }
            });
            let v = post(client.post(&url).header("x-goog-api-key", key), body).await?;
            v.pointer("/candidates/0/content/parts/0/text").and_then(Value::as_str).unwrap_or_default().to_string()
        }
        "openrouter" => {
            let key = api_key("openrouter")?;
            let url = format!("{}/chat/completions", base(&cfg.openrouter, &defaults.openrouter.base_url));
            let body = json!({
                "model": model(&cfg.openrouter, &defaults.openrouter.model),
                "temperature": 0.1,
                "messages": [
                    { "role": "system", "content": SYSTEM_PROMPT },
                    { "role": "user", "content": user }
                ]
            });
            let r = client.post(&url).bearer_auth(key).header("X-Title", "AureliaSpace");
            let v = post(r, body).await?;
            v.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or_default().to_string()
        }
        other => return Err(format!("unknown suggestions provider '{other}'")),
    };

    let cmd = clean(&text);
    if cmd.is_empty() {
        Err("The model returned an empty suggestion.".into())
    } else {
        Ok(cmd)
    }
}

#[tauri::command]
pub async fn suggest_command(request: SuggestRequest) -> Result<String, String> {
    let cfg = config::load().suggestions;
    run(&cfg, &request).await
}

#[tauri::command]
pub fn set_api_key(provider: String, key: String) -> Result<(), String> {
    if !matches!(provider.as_str(), "gemini" | "openrouter") {
        return Err("only gemini and openrouter use API keys".into());
    }
    let entry = key_entry(&provider)?;
    if key.trim().is_empty() {
        let _ = entry.delete_credential();
        Ok(())
    } else {
        entry.set_password(key.trim()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn has_api_key(provider: String) -> bool {
    key_entry(&provider).and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok()
}
