//! API keys for third-party coding-agent CLIs. Keys live in the macOS Keychain (same service
//! as the suggestion providers) and are injected into a pane's environment at spawn, so they
//! never touch config.json or the saved layout.

use std::collections::HashMap;
use std::sync::Mutex;

const KEYCHAIN_SERVICE: &str = "AureliaSpace";
/// Key ids the launcher may store. `gemini` is shared with the command-suggestion provider.
const KEY_IDS: &[&str] = &["openai", "gemini", "deepseek", "xai", "cursor"];

/// Keychain reads can prompt; each key is read once per run and reused for every pane.
static CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn key_entry(id: &str) -> Result<keyring::Entry, String> {
    if !KEY_IDS.contains(&id) {
        return Err(format!("unknown key id '{id}'"));
    }
    keyring::Entry::new(KEYCHAIN_SERVICE, &format!("{id}-api-key")).map_err(|e| e.to_string())
}

fn read_key(id: &str) -> Result<String, String> {
    if let Some(k) = CACHE.lock().unwrap().as_ref().and_then(|m| m.get(id)) {
        return Ok(k.clone());
    }
    let key = key_entry(id)?.get_password().map_err(|_| format!("No {id} API key saved in the Keychain."))?;
    CACHE.lock().unwrap().get_or_insert_with(HashMap::new).insert(id.to_string(), key.clone());
    Ok(key)
}

fn valid_env_name(n: &str) -> bool {
    !n.is_empty()
        && !n.starts_with(|c: char| c.is_ascii_digit())
        && n.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// Variables a pane may set for its agent: plain `env`, plus `secret_env` mapping a variable
/// name to the Keychain key id whose value it receives.
pub fn resolve_env(
    env: Option<HashMap<String, String>>,
    secret_env: Option<HashMap<String, String>>,
) -> Result<Vec<(String, String)>, String> {
    const RESERVED: &[&str] = &["PATH", "HOME", "SHELL", "ZDOTDIR", "TERM", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES"];
    let mut out = Vec::new();
    for (k, v) in env.unwrap_or_default() {
        if !valid_env_name(&k) || RESERVED.contains(&k.as_str()) {
            return Err(format!("environment variable '{k}' not allowed"));
        }
        out.push((k, v));
    }
    for (k, id) in secret_env.unwrap_or_default() {
        if !valid_env_name(&k) || RESERVED.contains(&k.as_str()) {
            return Err(format!("environment variable '{k}' not allowed"));
        }
        out.push((k, read_key(&id)?));
    }
    Ok(out)
}

#[tauri::command]
pub fn set_agent_key(id: String, key: String) -> Result<(), String> {
    let entry = key_entry(&id)?;
    if let Some(m) = CACHE.lock().unwrap().as_mut() {
        m.remove(&id);
    }
    if key.trim().is_empty() {
        let _ = entry.delete_credential();
        Ok(())
    } else {
        entry.set_password(key.trim()).map_err(|e| e.to_string())
    }
}

/// Which of `ids` have a saved key. Presence check only; values are never sent to the UI.
#[tauri::command]
pub fn agent_keys_present(ids: Vec<String>) -> Vec<String> {
    ids.into_iter()
        .filter(|id| key_entry(id).and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok())
        .collect()
}
