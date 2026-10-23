//! Chat panes: Claude Code runs in its headless protocol mode and the frontend draws the
//! conversation itself, with no terminal. Each pane's CLI is a child process speaking
//! JSON lines: `claude -p --input-format stream-json --output-format stream-json`.
//! Approvals arrive as `can_use_tool` control requests, and `interrupt` stops a turn.
//!
//! Every line goes to the frontend as `Raw`, which the chat view draws from. The facts
//! other features need (session id, status, approvals, turn end with usage) are pulled
//! out here into typed events.

use crate::config;
use crate::integration;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

/// How much of the CLI's stderr to keep for the exit event.
const STDERR_TAIL: usize = 4 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Working,
    /// An approval is waiting on the user.
    Waiting,
    Idle,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Completed,
    Interrupted,
    Failed,
}

/// One turn's tokens and cost.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    cost_usd: f64,
    /// Tokens in the context after this turn, and the model's window.
    context_tokens: Option<u64>,
    context_window: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatEvent {
    /// One message from the CLI, as sent.
    Raw { msg: Value },
    /// Claude's session id: the conversation to resume after a restart.
    Session { id: String },
    Status { status: Status },
    /// A tool wants permission; answer with `chat_answer(id)`.
    #[serde(rename_all = "camelCase")]
    Approval { id: String, tool: String, input: Value, description: Option<String> },
    #[serde(rename_all = "camelCase")]
    TurnEnd { outcome: Outcome, error: Option<String>, usage: Option<Usage>, duration_ms: Option<u64> },
    /// The CLI turned down something we asked of it, e.g. a model switch.
    #[serde(rename_all = "camelCase")]
    ControlError { error: String },
    #[serde(rename_all = "camelCase")]
    Exit { code: Option<i32>, stderr: String },
}

/// What one line from the CLI asks of us.
#[derive(Debug, PartialEq)]
enum Step {
    Emit(ChatEvent),
    /// A line to write back to the CLI.
    Send(Value),
}

/// An approval the CLI is blocked on.
#[derive(Debug)]
struct Pending {
    input: Value,
    suggestions: Option<Value>,
}

/// One pane's protocol state; no I/O, so it can be tested on recorded lines.
#[derive(Default)]
struct Protocol {
    session: Option<String>,
    pending: HashMap<String, Pending>,
    /// Messages sent and not yet answered by a `result`.
    turns: usize,
    interrupting: bool,
    /// Our own control requests so far, for their ids.
    requests: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Image {
    media_type: String,
    data: String,
}

impl Protocol {
    fn new(resume: Option<String>) -> Self {
        Protocol { session: resume, ..Protocol::default() }
    }

    /// A message, with pasted images first as base64 blocks (Claude Code takes them as-is).
    /// `uuid` becomes the message's id in the session, which `rewind_files` names it by.
    fn send_message(&mut self, text: &str, images: &[Image], uuid: Option<&str>) -> Vec<Step> {
        self.turns += 1;
        let content = if images.is_empty() {
            json!(text)
        } else {
            let mut blocks: Vec<Value> = images
                .iter()
                .map(|i| json!({ "type": "image", "source": { "type": "base64", "media_type": i.media_type, "data": i.data } }))
                .collect();
            if !text.is_empty() {
                blocks.push(json!({ "type": "text", "text": text }));
            }
            json!(blocks)
        };
        let mut msg = json!({ "type": "user", "message": { "role": "user", "content": content } });
        if let Some(u) = uuid {
            msg["uuid"] = json!(u);
        }
        vec![Step::Emit(ChatEvent::Status { status: Status::Working }), Step::Send(msg)]
    }

    /// Switches model and effort for the next turns. `"default"` goes back to what the
    /// account's settings pick. Spawning passes the same choice as `--model` / `--effort`.
    fn configure(&mut self, model: Option<&str>, effort: Option<&str>, style: Option<&str>) -> Vec<Value> {
        self.requests += 1;
        let n = self.requests;
        let or_null = |v: &str| if v == "default" { Value::Null } else { json!(v) };
        let mut lines = vec![];
        if let Some(m) = model {
            lines.push(json!({ "type": "control_request", "request_id": format!("model-{n}"), "request": { "subtype": "set_model", "model": or_null(m) } }));
        }
        if let Some(e) = effort {
            lines.push(json!({ "type": "control_request", "request_id": format!("effort-{n}"),
                "request": { "subtype": "apply_flag_settings", "settings": { "effortLevel": or_null(e) } } }));
        }
        // An output style (Concise, Explanatory…) for the session only; settings.json keeps its own.
        if let Some(st) = style {
            lines.push(json!({ "type": "control_request", "request_id": format!("style-{n}"),
                "request": { "subtype": "apply_flag_settings", "settings": { "outputStyle": st } } }));
        }
        lines
    }

    /// Claude Code's permission mode (`default`, `acceptEdits`, `plan`, `auto`,
    /// `bypassPermissions`), applied now, mid-turn too, like Shift+Tab in the CLI.
    fn set_mode(&mut self, mode: &str) -> Value {
        self.requests += 1;
        json!({ "type": "control_request", "request_id": format!("mode-{}", self.requests), "request": { "subtype": "set_permission_mode", "mode": mode } })
    }

    /// A control request of ours whose answer someone waits for (see `ask`).
    fn request(&mut self, request: Value) -> (String, Value) {
        self.requests += 1;
        let id = format!("req-{}", self.requests);
        let line = json!({ "type": "control_request", "request_id": id, "request": request });
        (id, line)
    }

    fn interrupt(&mut self) -> Option<Value> {
        if self.turns == 0 {
            return None;
        }
        self.interrupting = true;
        Some(json!({ "type": "control_request", "request_id": format!("interrupt-{}", self.turns), "request": { "subtype": "interrupt" } }))
    }

    /// Answers approval `id`. `always` also applies the CLI's permission suggestions, so
    /// the same thing isn't asked again; `permissions` gives our own instead (e.g. a plan
    /// approved straight into accept-edits). `input` replaces the tool's input, e.g. the
    /// `answers` an AskUserQuestion call gets back. `message` tells Claude why it was denied.
    fn answer(&mut self, id: &str, allow: bool, always: bool, input: Option<Value>, permissions: Option<Value>, message: Option<String>) -> Result<Vec<Step>, String> {
        let pending = self.pending.remove(id).ok_or_else(|| format!("no approval {id} waiting"))?;
        let Pending { suggestions, .. } = pending;
        let input = input.unwrap_or(pending.input);
        let updates = permissions.or(suggestions.filter(|_| always));
        let response = match (allow, updates) {
            (true, Some(u)) => json!({ "behavior": "allow", "updatedInput": input, "updatedPermissions": u }),
            (true, None) => json!({ "behavior": "allow", "updatedInput": input }),
            (false, _) => {
                let why = message.filter(|m| !m.trim().is_empty()).map_or("The user declined this.".into(), |m| format!("The user declined this and said: {m}"));
                json!({ "behavior": "deny", "message": why })
            }
        };
        let reply = json!({ "type": "control_response", "response": { "subtype": "success", "request_id": id, "response": response } });
        let status = if self.pending.is_empty() { Status::Working } else { Status::Waiting };
        Ok(vec![Step::Send(reply), Step::Emit(ChatEvent::Status { status })])
    }

    fn on_line(&mut self, m: Value) -> Vec<Step> {
        let mut steps = vec![];
        if let Some(id) = m["session_id"].as_str().filter(|id| !id.is_empty() && self.session.as_deref() != Some(*id)) {
            self.session = Some(id.to_string());
            steps.push(Step::Emit(ChatEvent::Session { id: id.to_string() }));
        }
        match m["type"].as_str() {
            Some("control_request") => {
                let id = m["request_id"].as_str().unwrap_or_default().to_string();
                let req = &m["request"];
                if req["subtype"] == "can_use_tool" {
                    let input = req["input"].clone();
                    let suggestions = req.get("permission_suggestions").filter(|s| s.is_array()).cloned();
                    self.pending.insert(id.clone(), Pending { input: input.clone(), suggestions });
                    steps.push(Step::Emit(ChatEvent::Approval {
                        id,
                        tool: req["tool_name"].as_str().unwrap_or_default().to_string(),
                        input,
                        description: req["description"].as_str().map(String::from),
                    }));
                    steps.push(Step::Emit(ChatEvent::Status { status: Status::Waiting }));
                } else {
                    // Anything unanswered blocks the turn forever.
                    steps.push(Step::Send(json!({ "type": "control_response", "response": {
                        "subtype": "error", "request_id": id, "error": format!("{} is not supported", req["subtype"]) } })));
                }
            }
            Some("control_response") if m["response"]["subtype"] == "error" => {
                let error = m["response"]["error"].as_str().unwrap_or("request failed").to_string();
                steps.push(Step::Emit(ChatEvent::ControlError { error }));
            }
            Some("result") => {
                self.turns = m["queued_turn_count"].as_u64().map(|n| n as usize).unwrap_or(self.turns.saturating_sub(1));
                let interrupted = self.interrupting || m["terminal_reason"] == "aborted_streaming";
                self.interrupting &= self.turns > 0;
                let outcome = match (interrupted, m["is_error"].as_bool().unwrap_or(false)) {
                    (true, _) => Outcome::Interrupted,
                    (false, true) => Outcome::Failed,
                    (false, false) => Outcome::Completed,
                };
                let error = (outcome == Outcome::Failed).then(|| claude_error(&m));
                let duration_ms = m["duration_ms"].as_u64();
                steps.push(Step::Emit(ChatEvent::TurnEnd { outcome, error, usage: claude_usage(&m), duration_ms }));
                if self.turns == 0 {
                    // The CLI has nothing left to ask about.
                    self.pending.clear();
                    steps.push(Step::Emit(ChatEvent::Status { status: Status::Idle }));
                }
            }
            _ => {}
        }
        steps.insert(0, Step::Emit(ChatEvent::Raw { msg: m }));
        steps
    }
}

fn claude_error(m: &Value) -> String {
    m["errors"]
        .as_array()
        .map(|e| e.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("; "))
        .filter(|e| !e.is_empty())
        .or_else(|| m["result"].as_str().map(String::from))
        .unwrap_or_else(|| m["subtype"].as_str().unwrap_or("error").to_string())
}

/// This turn's usage from a Claude `result`: `model_usage_since_last_result` is per turn
/// (`usage` and `total_cost_usd` add up over the whole process).
fn claude_usage(m: &Value) -> Option<Usage> {
    let models = m["model_usage_since_last_result"].as_object().filter(|o| !o.is_empty())?;
    let mut u = Usage::default();
    for v in models.values() {
        let n = |k: &str| v[k].as_u64().unwrap_or(0);
        u.input_tokens += n("inputTokens");
        u.output_tokens += n("outputTokens");
        u.cache_read_tokens += n("cacheReadInputTokens");
        u.cache_write_tokens += n("cacheCreationInputTokens");
        u.cost_usd += v["costUSD"].as_f64().unwrap_or(0.0);
        u.context_window = u.context_window.max(v["contextWindow"].as_u64());
    }
    // The context is what the last model call read.
    u.context_tokens = m["usage"]["iterations"].as_array().and_then(|it| it.last()).map(|last| {
        ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"]
            .iter()
            .map(|k| last[*k].as_u64().unwrap_or(0))
            .sum()
    });
    Some(u)
}

struct Chat {
    proto: Mutex<Protocol>,
    stdin: Mutex<ChildStdin>,
    /// Also the process group id: the CLI's MCP servers and shells go with it.
    pid: u32,
    generation: u64,
    events: Channel<ChatEvent>,
    /// Our requests that wait for their `control_response` (by request id).
    waiters: Mutex<HashMap<String, std::sync::mpsc::Sender<Value>>>,
}

impl Chat {
    fn run(&self, steps: Vec<Step>) -> Result<(), String> {
        for step in steps {
            match step {
                Step::Emit(ev) => {
                    let _ = self.events.send(ev);
                }
                Step::Send(line) => self.write(&line)?,
            }
        }
        Ok(())
    }

    fn write(&self, line: &Value) -> Result<(), String> {
        let mut stdin = self.stdin.lock().unwrap();
        writeln!(stdin, "{line}").and_then(|_| stdin.flush()).map_err(|e| e.to_string())
    }

    fn kill(&self) {
        unsafe {
            libc::killpg(self.pid as i32, libc::SIGTERM);
        }
    }
}

#[derive(Default)]
pub struct ChatState {
    chats: Mutex<HashMap<String, Arc<Chat>>>,
    generation: Mutex<u64>,
}

fn chat(state: &ChatState, pane_id: &str) -> Result<Arc<Chat>, String> {
    state.chats.lock().unwrap().get(pane_id).cloned().ok_or_else(|| format!("no chat in pane {pane_id}"))
}

/// The CLI's command line, run through the login shell so it gets the user's PATH (an app
/// started from Finder has launchd's minimal one) just like in a terminal pane.
fn command(cfg: &config::Config, resume: Option<&str>, resume_at: Option<&str>, fork: bool, model: Option<&str>, effort: Option<&str>, mode: Option<&str>) -> Vec<String> {
    let paths = integration::paths();
    let bin = crate::which::locate("claude").map_or("claude".into(), |p| p.to_string_lossy().into_owned());
    let mut cmd = vec![crate::pty::default_shell(cfg), "-l".into(), "-c".into(), "exec \"$0\" \"$@\"".into(), bin];
    cmd.extend(
        [
            "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--include-partial-messages", "--verbose",
            // Hidden from `claude --help` (2.1.309) but needed: without it approvals are
            // denied instead of being sent to us as `can_use_tool` requests.
            "--permission-prompt-tool", "stdio",
            // Makes Bypass one of the modes the chat can switch to (it isn't turned on by this).
            "--allow-dangerously-skip-permissions",
        ]
        .map(String::from),
    );
    // Same hooks and MCP servers as `claude` in a terminal pane (integration.zsh).
    cmd.extend(["--settings".into(), paths.claude_settings.to_string_lossy().into_owned()]);
    if paths.claude_mcp.is_file() {
        cmd.push(format!("--mcp-config={}", paths.claude_mcp.to_string_lossy()));
    }
    if let Some(id) = resume {
        cmd.extend(["--resume".into(), id.into()]);
        // Editing an earlier message: a copy of the conversation cut just before it.
        if let Some(at) = resume_at {
            cmd.extend(["--resume-session-at".into(), at.into(), "--fork-session".into()]);
        } else if fork {
            // Forking a chat: the whole conversation, as a new session beside the old one.
            cmd.push("--fork-session".into());
        }
    }
    if let Some(m) = model.filter(|m| *m != "default") {
        cmd.extend(["--model".into(), m.into()]);
    }
    if let Some(e) = effort.filter(|e| *e != "default") {
        cmd.extend(["--effort".into(), e.into()]);
    }
    if let Some(m) = mode.filter(|m| !m.is_empty()) {
        cmd.extend(["--permission-mode".into(), m.into()]);
    }
    cmd
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSpawned {
    /// The requested folder, when it doesn't exist and the chat started elsewhere.
    missing_cwd: Option<String>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn chat_spawn(
    app: AppHandle,
    state: State<'_, ChatState>,
    pane_id: String,
    cwd: Option<String>,
    account: Option<String>,
    env: Option<HashMap<String, String>>,
    secret_env: Option<HashMap<String, String>>,
    resume: Option<String>,
    resume_at: Option<String>,
    fork: Option<bool>,
    model: Option<String>,
    effort: Option<String>,
    permission_mode: Option<String>,
    on_event: Channel<ChatEvent>,
) -> Result<ChatSpawned, String> {
    // A webview reload opens existing panes again: stop the old process.
    if let Some(old) = state.chats.lock().unwrap().remove(&pane_id) {
        old.kill();
    }

    let cfg = config::load();
    let missing_cwd = cwd.clone().filter(|c| !c.is_empty() && !Path::new(&config::expand_path(c)).is_dir());
    let dir = crate::pty::pane_dir(&cfg, cwd);
    let vars = crate::pty::pane_env(&cfg, &pane_id, account, env, secret_env)?;
    let resume = resume.filter(|r| !r.is_empty());
    let argv = command(&cfg, resume.as_deref(), resume_at.as_deref().filter(|a| !a.is_empty()), fork.unwrap_or(false), model.as_deref(), effort.as_deref(), permission_mode.as_deref());
    let mut child: Child = Command::new(&argv[0])
        .args(&argv[1..])
        .current_dir(&dir)
        .env_clear()
        .envs(vars)
        // Lets a turn's file changes be undone with `rewind_files` (chat_rewind).
        .env("CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .map_err(|e| format!("couldn't start {}: {e}", argv[4]))?;
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();

    let generation = {
        let mut g = state.generation.lock().unwrap();
        *g += 1;
        *g
    };
    let chat = Arc::new(Chat { proto: Mutex::new(Protocol::new(resume)), stdin: Mutex::new(stdin), pid: child.id(), generation, events: on_event, waiters: Mutex::default() });
    state.chats.lock().unwrap().insert(pane_id.clone(), chat.clone());

    // Drained on its own so a chatty CLI never blocks on a full pipe.
    let tail = Arc::new(Mutex::new(String::new()));
    let tail_w = tail.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = stderr.read(&mut buf) {
            if n == 0 {
                break;
            }
            let mut t = tail_w.lock().unwrap();
            t.push_str(&String::from_utf8_lossy(&buf[..n]));
            if t.len() > STDERR_TAIL {
                let mut cut = t.len() - STDERR_TAIL;
                while !t.is_char_boundary(cut) {
                    cut += 1;
                }
                t.drain(..cut);
            }
        }
    });

    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            // A login shell's startup files may print to stdout before the CLI starts.
            let Ok(msg) = serde_json::from_str::<Value>(line.trim()) else { continue };
            if msg["type"] == "control_response" {
                let id = msg["response"]["request_id"].as_str().unwrap_or_default();
                if let Some(tx) = chat.waiters.lock().unwrap().remove(id) {
                    let _ = tx.send(msg["response"].clone());
                    continue;
                }
            }
            let steps = chat.proto.lock().unwrap().on_line(msg);
            if chat.run(steps).is_err() {
                break;
            }
        }
        let code = child.wait().ok().and_then(|s| s.code());
        let stderr = std::mem::take(&mut *tail.lock().unwrap());
        let _ = chat.events.send(ChatEvent::Exit { code, stderr });
        let state = app.state::<ChatState>();
        let mut chats = state.chats.lock().unwrap();
        if chats.get(&pane_id).map(|c| c.generation) == Some(chat.generation) {
            chats.remove(&pane_id);
        }
    });

    Ok(ChatSpawned { missing_cwd })
}

#[tauri::command]
pub fn chat_send(state: State<'_, ChatState>, pane_id: String, text: String, images: Option<Vec<Image>>, uuid: Option<String>) -> Result<(), String> {
    let chat = chat(&state, &pane_id)?;
    let steps = chat.proto.lock().unwrap().send_message(&text, images.as_deref().unwrap_or_default(), uuid.as_deref());
    chat.run(steps)
}

#[tauri::command]
pub fn chat_configure(state: State<'_, ChatState>, pane_id: String, model: Option<String>, effort: Option<String>, style: Option<String>) -> Result<(), String> {
    let chat = chat(&state, &pane_id)?;
    let lines = chat.proto.lock().unwrap().configure(model.as_deref(), effort.as_deref(), style.as_deref());
    lines.iter().try_for_each(|l| chat.write(l))
}

#[tauri::command]
pub fn chat_set_mode(state: State<'_, ChatState>, pane_id: String, mode: String) -> Result<(), String> {
    let chat = chat(&state, &pane_id)?;
    let line = chat.proto.lock().unwrap().set_mode(&mode);
    chat.write(&line)
}

/// Sends `request` to the chat's CLI and waits for its `control_response`.
async fn ask(state: &ChatState, pane_id: &str, request: Value) -> Result<Value, String> {
    let chat = chat(state, pane_id)?;
    let (id, line) = chat.proto.lock().unwrap().request(request);
    let (tx, rx) = std::sync::mpsc::channel();
    chat.waiters.lock().unwrap().insert(id.clone(), tx);
    if let Err(e) = chat.write(&line) {
        chat.waiters.lock().unwrap().remove(&id);
        return Err(e);
    }
    let got = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(15))).await.map_err(|e| e.to_string())?;
    chat.waiters.lock().unwrap().remove(&id);
    let mut r = got.map_err(|_| "Claude Code didn't answer".to_string())?;
    if r["subtype"] == "error" {
        return Err(r["error"].as_str().unwrap_or("request failed").to_string());
    }
    Ok(r["response"].take())
}

/// What fills the chat's context window, as Claude Code's `/context` counts it: categories
/// (system prompt, tools, MCP tools, memory files, skills, messages, free space…) with tokens.
#[tauri::command]
pub async fn chat_context_usage(state: State<'_, ChatState>, pane_id: String) -> Result<Value, String> {
    let mut usage = ask(&state, &pane_id, json!({ "subtype": "get_context_usage" })).await?;
    // The terminal grid is drawn from the categories; we don't need it.
    if let Some(o) = usage.as_object_mut() {
        o.remove("gridRows");
    }
    Ok(usage)
}

/// Puts the files Claude changed since message `uuid` back as they were before it (Claude
/// Code's own file checkpoints). `dry_run` only reports what would change:
/// `{canRewind, filesChanged, insertions, deletions}`.
#[tauri::command]
pub async fn chat_rewind(state: State<'_, ChatState>, pane_id: String, uuid: String, dry_run: bool) -> Result<Value, String> {
    let r = ask(&state, &pane_id, json!({ "subtype": "rewind_files", "user_message_id": uuid, "dry_run": dry_run })).await?;
    match r["canRewind"].as_bool() {
        Some(false) => Err(r["error"].as_str().unwrap_or("Claude Code has no checkpoint for that message").to_string()),
        _ => Ok(r),
    }
}

/// The chat's slash commands (built-ins, custom commands, skills) with descriptions, from
/// the CLI's `initialize` answer, which also names its models.
#[tauri::command]
pub async fn chat_commands(state: State<'_, ChatState>, pane_id: String) -> Result<Value, String> {
    let r = ask(&state, &pane_id, json!({ "subtype": "initialize" })).await?;
    Ok(json!({ "commands": r["commands"], "models": r["models"], "styles": r["available_output_styles"], "style": r["output_style"] }))
}

#[tauri::command]
pub fn chat_interrupt(state: State<'_, ChatState>, pane_id: String) -> Result<(), String> {
    let chat = chat(&state, &pane_id)?;
    let line = chat.proto.lock().unwrap().interrupt();
    line.map_or(Ok(()), |l| chat.write(&l))
}

#[tauri::command]
pub fn chat_answer(
    state: State<'_, ChatState>,
    pane_id: String,
    id: String,
    allow: bool,
    always: Option<bool>,
    input: Option<Value>,
    permissions: Option<Value>,
    message: Option<String>,
) -> Result<(), String> {
    let chat = chat(&state, &pane_id)?;
    let steps = chat.proto.lock().unwrap().answer(&id, allow, always.unwrap_or(false), input, permissions, message)?;
    chat.run(steps)
}

/// Earlier messages of a conversation the chat resumes (`--resume` doesn't replay them):
/// the user and assistant lines of its transcript, newest `limit` of them.
#[tauri::command]
pub fn chat_history(account: Option<String>, cwd: String, session: String, limit: Option<usize>) -> Result<Vec<Value>, String> {
    Ok(history_lines(&session_text(account, cwd, &session)?, limit.unwrap_or(400)))
}

fn session_text(account: Option<String>, cwd: String, session: &str) -> Result<String, String> {
    if session.is_empty() || !session.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("not a session id".into());
    }
    let cfg = config::load();
    let base = match account {
        Some(name) => cfg.accounts.iter().find(|a| a.name == name).ok_or_else(|| format!("unknown account '{name}'"))?.resolved_dir(),
        None => config::home_dir().join(".claude").to_string_lossy().into_owned(),
    };
    let path = Path::new(&base)
        .join("projects")
        .join(crate::handoff::project_slug(&crate::pty::pane_dir(&cfg, Some(cwd))))
        .join(format!("{session}.jsonl"));
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

/// The entry just before message `uuid` in a session (its `parentUuid`): where a copy of
/// the conversation is cut to edit that message. None when it was the first.
#[tauri::command]
pub fn chat_parent(account: Option<String>, cwd: String, session: String, uuid: String) -> Result<Option<String>, String> {
    parent_of(&session_text(account, cwd, &session)?, &uuid)
}

fn parent_of(text: &str, uuid: &str) -> Result<Option<String>, String> {
    let line = text
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .find(|m| m["uuid"] == uuid)
        .ok_or("that message isn't in the saved conversation yet")?;
    Ok(line["parentUuid"].as_str().map(String::from))
}

fn history_lines(text: &str, limit: usize) -> Vec<Value> {
    let mut lines: Vec<Value> = text
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|m| matches!(m["type"].as_str(), Some("user" | "assistant")))
        // Subagent turns and injected context aren't part of the conversation shown.
        .filter(|m| m["isSidechain"] != true && m["isMeta"] != true)
        .collect();
    let cut = lines.len().saturating_sub(limit);
    lines.drain(..cut);
    lines
}

#[tauri::command]
pub fn chat_kill(state: State<'_, ChatState>, pane_id: String) {
    if let Some(chat) = state.chats.lock().unwrap().remove(&pane_id) {
        chat.kill();
    }
}

pub fn kill_all(state: &ChatState) {
    for (_, chat) in state.chats.lock().unwrap().drain() {
        chat.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    fn events(steps: &[Step]) -> Vec<&ChatEvent> {
        steps
            .iter()
            .filter_map(|s| match s {
                Step::Emit(ChatEvent::Raw { .. }) => None,
                Step::Emit(e) => Some(e),
                _ => None,
            })
            .collect()
    }

    fn sent(steps: &[Step]) -> Vec<&Value> {
        steps.iter().filter_map(|s| if let Step::Send(v) = s { Some(v) } else { None }).collect()
    }

    // Lines below are trimmed from claude 2.1.309 runs.

    #[test]
    fn claude_session_id_is_reported_once() {
        let mut p = Protocol::new(None);
        let init = line(r#"{"type":"system","subtype":"init","session_id":"s-1","model":"claude-haiku-5-5"}"#);
        assert_eq!(events(&p.on_line(init.clone())), vec![&ChatEvent::Session { id: "s-1".into() }]);
        assert!(events(&p.on_line(init)).is_empty());
    }

    #[test]
    fn claude_approval_waits_and_is_answered() {
        let mut p = Protocol::new(None);
        p.send_message("hi", &[], None);
        let req = line(r#"{"type":"control_request","request_id":"r-1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"echo hi > out.txt"},"description":"Write hi","permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"echo hi *"}],"behavior":"allow","destination":"localSettings"}]}}"#);
        let steps = p.on_line(req);
        assert!(matches!(events(&steps)[0], ChatEvent::Approval { id, tool, .. } if id == "r-1" && tool == "Bash"));
        assert_eq!(events(&steps)[1], &ChatEvent::Status { status: Status::Waiting });

        let steps = p.answer("r-1", true, true, None, None, None).unwrap();
        let reply = sent(&steps)[0];
        assert_eq!(reply["response"]["request_id"], "r-1");
        assert_eq!(reply["response"]["response"]["behavior"], "allow");
        assert_eq!(reply["response"]["response"]["updatedInput"]["command"], "echo hi > out.txt");
        assert_eq!(reply["response"]["response"]["updatedPermissions"][0]["type"], "addRules");
        assert!(p.answer("r-1", true, false, None, None, None).is_err());
    }

    #[test]
    fn ask_user_question_gets_its_answers_back_as_input() {
        let mut p = Protocol::new(None);
        p.on_line(line(r#"{"type":"control_request","request_id":"q-1","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion","input":{"questions":[{"question":"Colour?","options":[{"label":"Red"},{"label":"Blue"}]}]}}}"#));
        let answered = json!({ "questions": [], "answers": { "Colour?": "Blue" } });
        let steps = p.answer("q-1", true, false, Some(answered), None, None).unwrap();
        assert_eq!(sent(&steps)[0]["response"]["response"]["updatedInput"]["answers"]["Colour?"], "Blue");
    }

    #[test]
    fn claude_unknown_control_requests_get_an_error() {
        let mut p = Protocol::new(None);
        let steps = p.on_line(line(r#"{"type":"control_request","request_id":"r-2","request":{"subtype":"elicitation"}}"#));
        assert_eq!(sent(&steps)[0]["response"]["subtype"], "error");
        assert_eq!(sent(&steps)[0]["response"]["request_id"], "r-2");
    }

    #[test]
    fn claude_result_ends_the_turn_with_its_own_usage() {
        let mut p = Protocol::new(None);
        p.send_message("hi", &[], None);
        let result = line(r#"{"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed","queued_turn_count":0,"session_id":"s-1","total_cost_usd":0.0034,"usage":{"iterations":[{"input_tokens":2,"output_tokens":7,"cache_read_input_tokens":24401,"cache_creation_input_tokens":3907}]},"model_usage_since_last_result":{"claude-haiku-5-5":{"inputTokens":2,"outputTokens":7,"cacheReadInputTokens":24401,"cacheCreationInputTokens":3907,"costUSD":0.001,"contextWindow":1000000}}}"#);
        let steps = p.on_line(result);
        let ev = events(&steps);
        let ChatEvent::TurnEnd { outcome, error, usage, .. } = ev[1] else { panic!("{ev:?}") };
        assert_eq!((*outcome, error), (Outcome::Completed, &None));
        let u = usage.as_ref().unwrap();
        assert_eq!((u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens), (2, 7, 24401, 3907));
        assert_eq!(u.cost_usd, 0.001);
        assert_eq!((u.context_tokens, u.context_window), (Some(28317), Some(1000000)));
        assert_eq!(ev[2], &ChatEvent::Status { status: Status::Idle });
    }

    #[test]
    fn an_edited_message_cuts_the_conversation_at_its_parent() {
        let text = [r#"{"type":"user","uuid":"u1","parentUuid":null}"#, r#"{"type":"assistant","uuid":"a1","parentUuid":"u1"}"#, r#"{"type":"user","uuid":"u2","parentUuid":"a1"}"#].join("\n");
        assert_eq!(parent_of(&text, "u2").unwrap().as_deref(), Some("a1"));
        assert_eq!(parent_of(&text, "u1").unwrap(), None);
        assert!(parent_of(&text, "nope").is_err());
        let cfg = config::Config::default();
        let argv = command(&cfg, Some("s1"), Some("a1"), false, None, None, None);
        assert!(argv.windows(4).any(|w| w == ["--resume", "s1", "--resume-session-at", "a1"]));
        assert!(argv.contains(&"--fork-session".to_string()));
        assert!(!command(&cfg, None, Some("a1"), true, None, None, None).contains(&"--fork-session".to_string()), "nothing to fork without a session");
        let forked = command(&cfg, Some("s1"), None, true, None, None, None);
        assert!(forked.windows(3).any(|w| w == ["--resume", "s1", "--fork-session"]));
    }

    #[test]
    fn pasted_images_go_before_the_text() {
        let mut p = Protocol::new(None);
        let img = Image { media_type: "image/png".into(), data: "AAAA".into() };
        let steps = p.send_message("what is this?", &[img], Some("u-1"));
        assert_eq!(sent(&steps)[0]["uuid"], "u-1");
        let content = &sent(&steps)[0]["message"]["content"];
        assert_eq!(content[0]["source"], json!({ "type": "base64", "media_type": "image/png", "data": "AAAA" }));
        assert_eq!(content[1], json!({ "type": "text", "text": "what is this?" }));
        assert_eq!(sent(&p.send_message("plain", &[], None))[0]["message"]["content"], json!("plain"));
    }

    #[test]
    fn model_and_effort_switch_by_control_request() {
        let mut p = Protocol::new(None);
        let lines = p.configure(Some("opus"), Some("default"), Some("Concise"));
        assert_eq!(lines[2]["request"]["settings"], json!({ "outputStyle": "Concise" }));
        assert_eq!(lines[0]["request"], json!({ "subtype": "set_model", "model": "opus" }));
        assert_eq!(lines[1]["request"]["settings"], json!({ "effortLevel": null }));
        assert_ne!(lines[0]["request_id"], p.configure(Some("haiku"), None, None)[0]["request_id"]);
        let steps = p.on_line(line(r#"{"type":"control_response","response":{"subtype":"error","request_id":"model-1","error":"bad model"}}"#));
        assert_eq!(events(&steps)[0], &ChatEvent::ControlError { error: "bad model".into() });
    }

    #[test]
    fn a_plan_can_start_in_another_mode_and_a_denial_carries_the_reason() {
        let mut p = Protocol::new(None);
        p.on_line(line(r#"{"type":"control_request","request_id":"x","request":{"subtype":"can_use_tool","tool_name":"ExitPlanMode","input":{"plan":"p"}}}"#));
        let set = json!([{ "type": "setMode", "mode": "acceptEdits", "destination": "session" }]);
        let steps = p.answer("x", true, false, None, Some(set.clone()), None).unwrap();
        assert_eq!(sent(&steps)[0]["response"]["response"]["updatedPermissions"], set);

        p.on_line(line(r#"{"type":"control_request","request_id":"y","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"rm x"}}}"#));
        let steps = p.answer("y", false, false, None, None, Some("use git rm".into())).unwrap();
        assert_eq!(sent(&steps)[0]["response"]["response"]["message"], "The user declined this and said: use git rm");
        assert_eq!(p.set_mode("auto")["request"], json!({ "subtype": "set_permission_mode", "mode": "auto" }));
    }

    #[test]
    fn claude_interrupt_ends_the_turn_as_interrupted() {
        let mut p = Protocol::new(None);
        assert!(p.interrupt().is_none(), "nothing to stop before a message");
        p.send_message("count to 200", &[], None);
        assert_eq!(p.interrupt().unwrap()["request"]["subtype"], "interrupt");
        let steps = p.on_line(line(r#"{"type":"result","subtype":"error_during_execution","is_error":true,"stop_reason":null,"terminal_reason":"aborted_streaming","queued_turn_count":0,"model_usage_since_last_result":{}}"#));
        assert!(matches!(events(&steps)[0], ChatEvent::TurnEnd { outcome: Outcome::Interrupted, usage: None, .. }));
    }

    #[test]
    fn history_keeps_the_conversation_only() {
        let text = [
            r#"{"type":"summary","summary":"x"}"#,
            r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"<system-reminder>"}}"#,
            r#"{"type":"user","message":{"role":"user","content":"hi"}}"#,
            r#"{"type":"assistant","isSidechain":true,"message":{"role":"assistant","content":[]}}"#,
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}"#,
            "not json",
        ]
        .join("\n");
        let lines = history_lines(&text, 10);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["message"]["content"], "hi");
        assert_eq!(history_lines(&text, 1)[0]["type"], "assistant");
    }

    /// Runs one real Claude turn through the same command line as a chat pane (costs a few
    /// cents): `cargo test --lib chat::tests::live_claude_turn -- --ignored`.
    #[test]
    #[ignore]
    fn live_claude_turn() {
        let cfg = config::Config::default();
        let argv = command(&cfg, None, None, false, None, None, None);
        let mut vars = crate::pty::pane_env(&cfg, "pane-smoke", None, None, None).unwrap();
        // Launched from Finder, the app only has launchd's PATH; the login shell must fix it.
        vars.insert("PATH".into(), "/usr/bin:/bin:/usr/sbin:/sbin".into());
        // Keep the running app's alerts out of it.
        vars.insert("AURELIA_EVENTS_FILE".into(), std::env::temp_dir().join("chat-smoke-events").to_string_lossy().into_owned());
        let mut child = Command::new(&argv[0])
            .args(&argv[1..])
            .args(["--model", "haiku"])
            .current_dir(std::env::temp_dir())
            .env_clear()
            .envs(vars)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let mut p = Protocol::new(None);
        for s in p.send_message("Reply with just the word OK.", &[], None) {
            if let Step::Send(v) = s {
                writeln!(stdin, "{v}").unwrap();
            }
        }
        let (mut session, mut end) = (None, None);
        for l in BufReader::new(child.stdout.take().unwrap()).lines() {
            let Ok(msg) = serde_json::from_str::<Value>(&l.unwrap()) else { continue };
            for s in p.on_line(msg) {
                match s {
                    Step::Emit(ChatEvent::Session { id }) => session = Some(id),
                    Step::Emit(e @ ChatEvent::TurnEnd { .. }) => end = Some(e),
                    _ => {}
                }
            }
            if end.is_some() {
                break;
            }
        }
        drop(stdin);
        let _ = child.wait();
        assert!(session.is_some());
        let Some(ChatEvent::TurnEnd { outcome: Outcome::Completed, usage: Some(u), .. }) = end else { panic!("{end:?}") };
        assert!(u.output_tokens > 0 && u.cost_usd > 0.0, "{u:?}");
    }
}
