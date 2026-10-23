//! Chat panes: Claude Code and Codex run in their headless protocol modes and the
//! frontend draws the conversation itself, with no terminal. Each pane's CLI is a child
//! process speaking JSON lines on stdin/stdout:
//! - Claude Code: `claude -p --input-format stream-json --output-format stream-json`.
//!   Approvals arrive as `can_use_tool` control requests, and `interrupt` stops a turn.
//! - Codex: `codex app-server` (JSON-RPC). `thread/start` or `thread/resume`, then one
//!   `turn/start` per message, and `turn/interrupt` stops it.
//!
//! Every line goes to the frontend as `Raw`, which the chat view draws from. The facts
//! other features need (session id, status, approvals, turn end with usage) are pulled
//! out here into typed events, so they don't have to understand two protocols.

use crate::config;
use crate::integration;
use serde::Serialize;
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

#[derive(Clone, Copy, Debug, PartialEq)]
enum Agent {
    Claude,
    Codex,
}

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

/// One turn's tokens and cost. Codex reports no cost.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    cost_usd: Option<f64>,
    /// Tokens in the context after this turn, and the model's window.
    context_tokens: Option<u64>,
    context_window: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatEvent {
    /// One message from the CLI, as sent.
    Raw { msg: Value },
    /// The conversation to resume after a restart: Claude's session id, Codex's thread id.
    Session { id: String },
    Status { status: Status },
    /// A tool wants permission; answer with `chat_answer(id)`.
    #[serde(rename_all = "camelCase")]
    Approval { id: String, tool: String, input: Value, description: Option<String> },
    #[serde(rename_all = "camelCase")]
    TurnEnd { outcome: Outcome, error: Option<String>, usage: Option<Usage> },
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
enum Pending {
    Claude { input: Value, suggestions: Option<Value> },
    Codex { rpc_id: Value, method: String },
}

/// One pane's protocol state; no I/O, so it can be tested on recorded lines.
struct Protocol {
    agent: Agent,
    session: Option<String>,
    pending: HashMap<String, Pending>,
    /// Claude: messages sent and not yet answered by a `result`.
    turns: usize,
    interrupting: bool,
    // Codex
    next_id: u64,
    /// Our requests awaiting a response, by id: the method.
    calls: HashMap<u64, String>,
    turn: Option<String>,
    cwd: String,
    /// `thread/start` or `thread/resume` has answered; until then messages are queued.
    ready: bool,
    /// Messages typed before the thread was ready.
    queued: Vec<String>,
    usage: Option<Usage>,
}

impl Protocol {
    fn new(agent: Agent, resume: Option<String>) -> Self {
        Protocol {
            agent,
            session: resume,
            pending: HashMap::new(),
            turns: 0,
            interrupting: false,
            next_id: 0,
            calls: HashMap::new(),
            turn: None,
            cwd: String::new(),
            ready: false,
            queued: Vec::new(),
            usage: None,
        }
    }

    fn call(&mut self, method: &str, params: Value) -> Value {
        self.next_id += 1;
        self.calls.insert(self.next_id, method.to_string());
        json!({ "jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params })
    }

    /// Lines to send as soon as the process starts.
    fn start(&mut self, cwd: &str) -> Vec<Value> {
        match self.agent {
            Agent::Claude => vec![],
            Agent::Codex => {
                self.cwd = cwd.to_string();
                let init = self.call("initialize", json!({ "clientInfo": { "name": "aureliaspace", "version": env!("CARGO_PKG_VERSION") } }));
                let thread = match self.session.clone() {
                    Some(id) => self.call("thread/resume", json!({ "threadId": id, "cwd": cwd })),
                    None => self.call("thread/start", json!({ "cwd": cwd })),
                };
                vec![init, json!({ "jsonrpc": "2.0", "method": "initialized" }), thread]
            }
        }
    }

    fn send_message(&mut self, text: &str) -> Vec<Step> {
        let status = Step::Emit(ChatEvent::Status { status: Status::Working });
        match self.agent {
            Agent::Claude => {
                self.turns += 1;
                let msg = json!({ "type": "user", "message": { "role": "user", "content": text } });
                vec![status, Step::Send(msg)]
            }
            Agent::Codex => match (self.ready, self.session.clone()) {
                // Starting or resuming the thread is still in flight; sent when it answers.
                (false, _) => {
                    self.queued.push(text.to_string());
                    vec![status]
                }
                (true, Some(thread)) => {
                    let msg = self.call("turn/start", json!({ "threadId": thread, "input": [{ "type": "text", "text": text }] }));
                    vec![status, Step::Send(msg)]
                }
                // `thread/start` failed: there is no conversation to send to.
                (true, None) => vec![
                    Step::Emit(ChatEvent::TurnEnd { outcome: Outcome::Failed, error: Some("Codex couldn't start a conversation".into()), usage: None }),
                    Step::Emit(ChatEvent::Status { status: Status::Idle }),
                ],
            },
        }
    }

    fn interrupt(&mut self) -> Option<Value> {
        match self.agent {
            Agent::Claude => {
                if self.turns == 0 {
                    return None;
                }
                self.interrupting = true;
                Some(json!({ "type": "control_request", "request_id": format!("interrupt-{}", self.turns), "request": { "subtype": "interrupt" } }))
            }
            Agent::Codex => {
                let (thread, turn) = (self.session.clone()?, self.turn.clone()?);
                Some(self.call("turn/interrupt", json!({ "threadId": thread, "turnId": turn })))
            }
        }
    }

    /// Answers approval `id`. `always` also allows what the CLI suggested for the rest of
    /// the session (Claude's permission suggestions, Codex's "for session").
    fn answer(&mut self, id: &str, allow: bool, always: bool) -> Result<Vec<Step>, String> {
        let pending = self.pending.remove(id).ok_or_else(|| format!("no approval {id} waiting"))?;
        let reply = match pending {
            Pending::Claude { input, suggestions } => {
                let response = match (allow, suggestions) {
                    (true, Some(s)) if always => json!({ "behavior": "allow", "updatedInput": input, "updatedPermissions": s }),
                    (true, _) => json!({ "behavior": "allow", "updatedInput": input }),
                    (false, _) => json!({ "behavior": "deny", "message": "The user declined this." }),
                };
                json!({ "type": "control_response", "response": { "subtype": "success", "request_id": id, "response": response } })
            }
            Pending::Codex { rpc_id, method } => {
                let decision = match (method.as_str(), allow, always) {
                    // The pre-v2 methods take the older decision names.
                    ("execCommandApproval" | "applyPatchApproval", true, false) => "approved",
                    ("execCommandApproval" | "applyPatchApproval", true, true) => "approved_for_session",
                    ("execCommandApproval" | "applyPatchApproval", false, _) => "denied",
                    (_, true, false) => "accept",
                    (_, true, true) => "acceptForSession",
                    (_, false, _) => "decline",
                };
                json!({ "jsonrpc": "2.0", "id": rpc_id, "result": { "decision": decision } })
            }
        };
        let status = if self.pending.is_empty() { Status::Working } else { Status::Waiting };
        Ok(vec![Step::Send(reply), Step::Emit(ChatEvent::Status { status })])
    }

    fn on_line(&mut self, msg: Value) -> Vec<Step> {
        let mut steps = match self.agent {
            Agent::Claude => self.on_claude(&msg),
            Agent::Codex => self.on_codex(&msg),
        };
        steps.insert(0, Step::Emit(ChatEvent::Raw { msg }));
        steps
    }

    fn set_session(&mut self, id: Option<&str>) -> Option<Step> {
        let id = id.filter(|id| !id.is_empty())?;
        if self.session.as_deref() == Some(id) {
            return None;
        }
        self.session = Some(id.to_string());
        Some(Step::Emit(ChatEvent::Session { id: id.to_string() }))
    }

    fn on_claude(&mut self, m: &Value) -> Vec<Step> {
        let mut steps: Vec<Step> = self.set_session(m["session_id"].as_str()).into_iter().collect();
        match m["type"].as_str() {
            Some("control_request") => {
                let id = m["request_id"].as_str().unwrap_or_default().to_string();
                let req = &m["request"];
                if req["subtype"] == "can_use_tool" {
                    let input = req["input"].clone();
                    let suggestions = req.get("permission_suggestions").filter(|s| s.is_array()).cloned();
                    self.pending.insert(id.clone(), Pending::Claude { input: input.clone(), suggestions });
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
            Some("result") => {
                self.turns = m["queued_turn_count"].as_u64().map(|n| n as usize).unwrap_or(self.turns.saturating_sub(1));
                let interrupted = self.interrupting || m["terminal_reason"] == "aborted_streaming";
                self.interrupting &= self.turns > 0;
                let outcome = match (interrupted, m["is_error"].as_bool().unwrap_or(false)) {
                    (true, _) => Outcome::Interrupted,
                    (false, true) => Outcome::Failed,
                    (false, false) => Outcome::Completed,
                };
                let error = (outcome == Outcome::Failed).then(|| claude_error(m));
                steps.push(Step::Emit(ChatEvent::TurnEnd { outcome, error, usage: claude_usage(m) }));
                if self.turns == 0 {
                    // The CLI has nothing left to ask about.
                    self.pending.clear();
                    steps.push(Step::Emit(ChatEvent::Status { status: Status::Idle }));
                }
            }
            _ => {}
        }
        steps
    }

    fn on_codex(&mut self, m: &Value) -> Vec<Step> {
        let mut steps = Vec::new();
        let method = m["method"].as_str();
        match (m.get("id"), method) {
            // A response to one of our calls.
            (Some(id), None) => {
                let call = id.as_u64().and_then(|id| self.calls.remove(&id)).unwrap_or_default();
                if let Some(err) = m.get("error") {
                    let error = err["message"].as_str().unwrap_or("request failed").to_string();
                    if call == "thread/resume" {
                        // E.g. a thread id from before a restart that Codex no longer has:
                        // say so, and carry on in a new thread with the queued messages.
                        steps.push(Step::Emit(ChatEvent::TurnEnd {
                            outcome: Outcome::Failed,
                            error: Some(format!("couldn't resume the conversation ({error}); starting a new one")),
                            usage: None,
                        }));
                        self.session = None;
                        let start = self.call("thread/start", json!({ "cwd": self.cwd }));
                        steps.push(Step::Send(start));
                    } else if call != "turn/interrupt" {
                        if call == "thread/start" {
                            self.ready = true;
                            self.queued.clear();
                        }
                        steps.push(Step::Emit(ChatEvent::TurnEnd { outcome: Outcome::Failed, error: Some(format!("{call}: {error}")), usage: None }));
                        steps.push(Step::Emit(ChatEvent::Status { status: Status::Idle }));
                    }
                } else if call == "thread/start" || call == "thread/resume" {
                    self.ready = true;
                    steps.extend(self.set_session(m["result"]["thread"]["id"].as_str()));
                    for text in std::mem::take(&mut self.queued) {
                        steps.extend(self.send_message(&text).into_iter().filter(|s| matches!(s, Step::Send(_))));
                    }
                }
            }
            // A request from Codex: approvals wait for the user, anything else is refused.
            (Some(id), Some(method)) => {
                let p = &m["params"];
                let approval = match method {
                    "item/commandExecution/requestApproval" | "execCommandApproval" => Some(("Bash", p["reason"].as_str())),
                    "item/fileChange/requestApproval" | "applyPatchApproval" => Some(("Edit", p["reason"].as_str())),
                    _ => None,
                };
                match approval {
                    Some((tool, reason)) => {
                        let key = id.to_string();
                        self.pending.insert(key.clone(), Pending::Codex { rpc_id: id.clone(), method: method.to_string() });
                        steps.push(Step::Emit(ChatEvent::Approval { id: key, tool: tool.into(), input: p.clone(), description: reason.map(String::from) }));
                        steps.push(Step::Emit(ChatEvent::Status { status: Status::Waiting }));
                    }
                    None => steps.push(Step::Send(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("{method} is not supported") } }))),
                }
            }
            (None, Some("thread/started")) => steps.extend(self.set_session(m["params"]["thread"]["id"].as_str())),
            (None, Some("turn/started")) => {
                self.turn = m["params"]["turn"]["id"].as_str().map(String::from);
                self.usage = None;
                steps.push(Step::Emit(ChatEvent::Status { status: Status::Working }));
            }
            (None, Some("thread/tokenUsage/updated")) => self.usage = codex_usage(&m["params"]["tokenUsage"]),
            (None, Some("serverRequest/resolved")) => {
                // Codex settled an approval itself (e.g. the turn was interrupted).
                if let Some(id) = m["params"].get("requestId").map(Value::to_string) {
                    self.pending.remove(&id);
                }
            }
            (None, Some("turn/completed")) => {
                let turn = &m["params"]["turn"];
                let outcome = match turn["status"].as_str() {
                    Some("interrupted") => Outcome::Interrupted,
                    Some("failed") => Outcome::Failed,
                    _ => Outcome::Completed,
                };
                let error = turn["error"]["message"].as_str().map(String::from);
                self.turn = None;
                self.pending.clear();
                steps.push(Step::Emit(ChatEvent::TurnEnd { outcome, error, usage: self.usage.take() }));
                steps.push(Step::Emit(ChatEvent::Status { status: Status::Idle }));
            }
            _ => {}
        }
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
    let mut u = Usage { cost_usd: Some(0.0), ..Usage::default() };
    for v in models.values() {
        let n = |k: &str| v[k].as_u64().unwrap_or(0);
        u.input_tokens += n("inputTokens");
        u.output_tokens += n("outputTokens");
        u.cache_read_tokens += n("cacheReadInputTokens");
        u.cache_write_tokens += n("cacheCreationInputTokens");
        u.cost_usd = u.cost_usd.map(|c| c + v["costUSD"].as_f64().unwrap_or(0.0));
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

fn codex_usage(t: &Value) -> Option<Usage> {
    let last = t.get("last")?;
    let n = |k: &str| last[k].as_u64().unwrap_or(0);
    Some(Usage {
        input_tokens: n("inputTokens").saturating_sub(n("cachedInputTokens")),
        output_tokens: n("outputTokens"),
        cache_read_tokens: n("cachedInputTokens"),
        cache_write_tokens: 0,
        cost_usd: None,
        context_tokens: Some(n("totalTokens")),
        context_window: t["modelContextWindow"].as_u64(),
    })
}

struct Chat {
    proto: Mutex<Protocol>,
    stdin: Mutex<ChildStdin>,
    /// Also the process group id: the CLI's MCP servers and shells go with it.
    pid: u32,
    generation: u64,
    events: Channel<ChatEvent>,
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
fn command(cfg: &config::Config, agent: Agent, resume: Option<&str>) -> Vec<String> {
    let mut argv: Vec<String> = match agent {
        Agent::Claude => {
            let paths = integration::paths();
            let mut a: Vec<String> = [
                "claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json",
                "--include-partial-messages", "--verbose",
                // Hidden from `claude --help` (2.1.309) but needed: without it approvals are
                // denied instead of being sent to us as `can_use_tool` requests.
                "--permission-prompt-tool", "stdio",
            ]
            .map(String::from)
            .into();
            // Same hooks and MCP servers as `claude` in a terminal pane (integration.zsh).
            a.extend(["--settings".into(), paths.claude_settings.to_string_lossy().into_owned()]);
            if paths.claude_mcp.is_file() {
                a.push(format!("--mcp-config={}", paths.claude_mcp.to_string_lossy()));
            }
            if let Some(id) = resume {
                a.extend(["--resume".into(), id.into()]);
            }
            a
        }
        Agent::Codex => vec!["codex".into(), "app-server".into()],
    };
    if let Some(bin) = crate::which::locate(&argv[0]) {
        argv[0] = bin.to_string_lossy().into_owned();
    }
    let mut cmd = vec![crate::pty::default_shell(cfg), "-l".into(), "-c".into(), "exec \"$0\" \"$@\"".into()];
    cmd.extend(argv);
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
    agent: String,
    cwd: Option<String>,
    account: Option<String>,
    env: Option<HashMap<String, String>>,
    secret_env: Option<HashMap<String, String>>,
    resume: Option<String>,
    on_event: Channel<ChatEvent>,
) -> Result<ChatSpawned, String> {
    let agent = match agent.as_str() {
        "claude" => Agent::Claude,
        "codex" => Agent::Codex,
        other => return Err(format!("no chat mode for '{other}'")),
    };
    // A webview reload opens existing panes again: stop the old process.
    if let Some(old) = state.chats.lock().unwrap().remove(&pane_id) {
        old.kill();
    }

    let cfg = config::load();
    let missing_cwd = cwd.clone().filter(|c| !c.is_empty() && !Path::new(&config::expand_path(c)).is_dir());
    let dir = crate::pty::pane_dir(&cfg, cwd);
    let vars = crate::pty::pane_env(&cfg, &pane_id, account, env, secret_env)?;
    let resume = resume.filter(|r| !r.is_empty());
    let argv = command(&cfg, agent, resume.as_deref());
    let mut child: Child = Command::new(&argv[0])
        .args(&argv[1..])
        .current_dir(&dir)
        .env_clear()
        .envs(vars)
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
    let mut proto = Protocol::new(agent, resume);
    let start = proto.start(&dir);
    let chat = Arc::new(Chat { proto: Mutex::new(proto), stdin: Mutex::new(stdin), pid: child.id(), generation, events: on_event });
    for line in start {
        chat.write(&line)?;
    }
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
pub fn chat_send(state: State<'_, ChatState>, pane_id: String, text: String) -> Result<(), String> {
    let chat = chat(&state, &pane_id)?;
    let steps = chat.proto.lock().unwrap().send_message(&text);
    chat.run(steps)
}

#[tauri::command]
pub fn chat_interrupt(state: State<'_, ChatState>, pane_id: String) -> Result<(), String> {
    let chat = chat(&state, &pane_id)?;
    let line = chat.proto.lock().unwrap().interrupt();
    line.map_or(Ok(()), |l| chat.write(&l))
}

#[tauri::command]
pub fn chat_answer(state: State<'_, ChatState>, pane_id: String, id: String, allow: bool, always: Option<bool>) -> Result<(), String> {
    let chat = chat(&state, &pane_id)?;
    let steps = chat.proto.lock().unwrap().answer(&id, allow, always.unwrap_or(false))?;
    chat.run(steps)
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

    fn ready(mut p: Protocol) -> Protocol {
        p.ready = true;
        p
    }

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

    // Lines below are trimmed from claude 2.1.309 and codex 0.159.2 runs.

    #[test]
    fn claude_session_id_is_reported_once() {
        let mut p = Protocol::new(Agent::Claude, None);
        let init = line(r#"{"type":"system","subtype":"init","session_id":"s-1","model":"claude-haiku-5-5"}"#);
        assert_eq!(events(&p.on_line(init.clone())), vec![&ChatEvent::Session { id: "s-1".into() }]);
        assert!(events(&p.on_line(init)).is_empty());
    }

    #[test]
    fn claude_approval_waits_and_is_answered() {
        let mut p = Protocol::new(Agent::Claude, None);
        p.send_message("hi");
        let req = line(r#"{"type":"control_request","request_id":"r-1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"echo hi > out.txt"},"description":"Write hi","permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"echo hi *"}],"behavior":"allow","destination":"localSettings"}]}}"#);
        let steps = p.on_line(req);
        assert!(matches!(events(&steps)[0], ChatEvent::Approval { id, tool, .. } if id == "r-1" && tool == "Bash"));
        assert_eq!(events(&steps)[1], &ChatEvent::Status { status: Status::Waiting });

        let steps = p.answer("r-1", true, true).unwrap();
        let reply = sent(&steps)[0];
        assert_eq!(reply["response"]["request_id"], "r-1");
        assert_eq!(reply["response"]["response"]["behavior"], "allow");
        assert_eq!(reply["response"]["response"]["updatedInput"]["command"], "echo hi > out.txt");
        assert_eq!(reply["response"]["response"]["updatedPermissions"][0]["type"], "addRules");
        assert!(p.answer("r-1", true, false).is_err());
    }

    #[test]
    fn claude_unknown_control_requests_get_an_error() {
        let mut p = Protocol::new(Agent::Claude, None);
        let steps = p.on_line(line(r#"{"type":"control_request","request_id":"r-2","request":{"subtype":"elicitation"}}"#));
        assert_eq!(sent(&steps)[0]["response"]["subtype"], "error");
        assert_eq!(sent(&steps)[0]["response"]["request_id"], "r-2");
    }

    #[test]
    fn claude_result_ends_the_turn_with_its_own_usage() {
        let mut p = Protocol::new(Agent::Claude, None);
        p.send_message("hi");
        let result = line(r#"{"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed","queued_turn_count":0,"session_id":"s-1","total_cost_usd":0.0034,"usage":{"iterations":[{"input_tokens":2,"output_tokens":7,"cache_read_input_tokens":24401,"cache_creation_input_tokens":3907}]},"model_usage_since_last_result":{"claude-haiku-5-5":{"inputTokens":2,"outputTokens":7,"cacheReadInputTokens":24401,"cacheCreationInputTokens":3907,"costUSD":0.001,"contextWindow":1000000}}}"#);
        let steps = p.on_line(result);
        let ev = events(&steps);
        let ChatEvent::TurnEnd { outcome, error, usage } = ev[1] else { panic!("{ev:?}") };
        assert_eq!((*outcome, error), (Outcome::Completed, &None));
        let u = usage.as_ref().unwrap();
        assert_eq!((u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens), (2, 7, 24401, 3907));
        assert_eq!(u.cost_usd, Some(0.001));
        assert_eq!((u.context_tokens, u.context_window), (Some(28317), Some(1000000)));
        assert_eq!(ev[2], &ChatEvent::Status { status: Status::Idle });
    }

    #[test]
    fn claude_interrupt_ends_the_turn_as_interrupted() {
        let mut p = Protocol::new(Agent::Claude, None);
        assert!(p.interrupt().is_none(), "nothing to stop before a message");
        p.send_message("count to 200");
        assert_eq!(p.interrupt().unwrap()["request"]["subtype"], "interrupt");
        let steps = p.on_line(line(r#"{"type":"result","subtype":"error_during_execution","is_error":true,"stop_reason":null,"terminal_reason":"aborted_streaming","queued_turn_count":0,"model_usage_since_last_result":{}}"#));
        assert!(matches!(events(&steps)[0], ChatEvent::TurnEnd { outcome: Outcome::Interrupted, usage: None, .. }));
    }

    #[test]
    fn codex_handshake_then_queued_message_goes_out_once_the_thread_exists() {
        let mut p = Protocol::new(Agent::Codex, None);
        let start = p.start("/tmp");
        let methods: Vec<_> = start.iter().map(|v| v["method"].as_str().unwrap()).collect();
        assert_eq!(methods, ["initialize", "initialized", "thread/start"]);
        assert!(sent(&p.send_message("hi")).is_empty());

        let steps = p.on_line(line(r#"{"id":2,"result":{"thread":{"id":"t-1","sessionId":"t-1"},"model":"gpt-6.1-sol"}}"#));
        assert_eq!(events(&steps), vec![&ChatEvent::Session { id: "t-1".into() }]);
        let turn = sent(&steps)[0];
        assert_eq!(turn["method"], "turn/start");
        assert_eq!(turn["params"]["threadId"], "t-1");
        assert_eq!(turn["params"]["input"][0]["text"], "hi");
    }

    #[test]
    fn codex_resume_skips_thread_start() {
        let mut p = Protocol::new(Agent::Codex, Some("t-9".into()));
        assert_eq!(p.start("/tmp")[2]["method"], "thread/resume");
        assert!(sent(&p.send_message("again")).is_empty(), "waits for the resume to answer");
        let steps = p.on_line(line(r#"{"id":2,"result":{"thread":{"id":"t-9"}}}"#));
        assert_eq!(sent(&steps)[0]["params"]["threadId"], "t-9");
    }

    #[test]
    fn codex_approval_round_trip_and_unknown_requests() {
        let mut p = ready(Protocol::new(Agent::Codex, Some("t-1".into())));
        let steps = p.on_line(line(r#"{"id":7,"method":"item/commandExecution/requestApproval","params":{"threadId":"t-1","turnId":"u-1","itemId":"i-1","startedAtMs":1,"command":"echo hi","reason":"needs write"}}"#));
        assert!(matches!(events(&steps)[0], ChatEvent::Approval { id, tool, description: Some(d), .. } if id == "7" && tool == "Bash" && d == "needs write"));
        let reply = p.answer("7", true, true).unwrap();
        assert_eq!(sent(&reply)[0], &json!({ "jsonrpc": "2.0", "id": 7, "result": { "decision": "acceptForSession" } }));

        p.on_line(line(r#"{"id":8,"method":"applyPatchApproval","params":{"callId":"c","conversationId":"t-1","fileChanges":{}}}"#));
        assert_eq!(sent(&p.answer("8", false, false).unwrap())[0]["result"]["decision"], "denied");

        let steps = p.on_line(line(r#"{"id":9,"method":"item/tool/requestUserInput","params":{}}"#));
        assert_eq!(sent(&steps)[0]["error"]["code"], -32601);
    }

    #[test]
    fn codex_turn_lifecycle_with_usage_and_interrupt() {
        let mut p = ready(Protocol::new(Agent::Codex, Some("t-1".into())));
        p.on_line(line(r#"{"method":"turn/started","params":{"threadId":"t-1","turn":{"id":"u-1","items":[],"status":"inProgress"}}}"#));
        let stop = p.interrupt().unwrap();
        assert_eq!((stop["method"].as_str(), stop["params"]["turnId"].as_str()), (Some("turn/interrupt"), Some("u-1")));
        p.on_line(line(r#"{"method":"thread/tokenUsage/updated","params":{"threadId":"t-1","turnId":"u-1","tokenUsage":{"last":{"inputTokens":1200,"cachedInputTokens":1000,"outputTokens":50,"reasoningOutputTokens":10,"totalTokens":1250},"total":{"inputTokens":1200,"cachedInputTokens":1000,"outputTokens":50,"reasoningOutputTokens":10,"totalTokens":1250},"modelContextWindow":272000}}}"#));
        let steps = p.on_line(line(r#"{"method":"turn/completed","params":{"threadId":"t-1","turn":{"id":"u-1","items":[],"status":"interrupted"}}}"#));
        let ev = events(&steps);
        let ChatEvent::TurnEnd { outcome: Outcome::Interrupted, usage: Some(u), .. } = ev[0] else { panic!("{ev:?}") };
        assert_eq!((u.input_tokens, u.cache_read_tokens, u.output_tokens, u.context_window), (200, 1000, 50, Some(272000)));
        assert_eq!(ev[1], &ChatEvent::Status { status: Status::Idle });
        assert!(p.interrupt().is_none());
    }

    /// Runs one real Claude turn through the same command line as a chat pane (costs a few
    /// cents): `cargo test --lib chat::tests::live_claude_turn -- --ignored`.
    #[test]
    #[ignore]
    fn live_claude_turn() {
        let cfg = config::Config::default();
        let argv = command(&cfg, Agent::Claude, None);
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
        let mut p = Protocol::new(Agent::Claude, None);
        for s in p.send_message("Reply with just the word OK.") {
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
        assert!(u.output_tokens > 0 && u.cost_usd.unwrap() > 0.0, "{u:?}");
    }

    #[test]
    fn codex_failed_resume_starts_a_new_thread_and_keeps_the_message() {
        let mut p = Protocol::new(Agent::Codex, Some("t-old".into()));
        p.start("/tmp");
        p.send_message("hi");
        let steps = p.on_line(line(r#"{"id":2,"error":{"code":-32600,"message":"thread not found"}}"#));
        assert!(matches!(events(&steps)[0], ChatEvent::TurnEnd { outcome: Outcome::Failed, .. }));
        assert_eq!(sent(&steps)[0]["method"], "thread/start");
        assert_eq!(sent(&steps)[0]["params"]["cwd"], "/tmp");
        let steps = p.on_line(line(r#"{"id":3,"result":{"thread":{"id":"t-new"}}}"#));
        assert_eq!(events(&steps), vec![&ChatEvent::Session { id: "t-new".into() }]);
        assert_eq!(sent(&steps)[0]["params"]["threadId"], "t-new");
    }

    #[test]
    fn codex_failed_thread_start_fails_later_messages_instead_of_queueing() {
        let mut p = Protocol::new(Agent::Codex, None);
        p.start("/tmp");
        p.send_message("hi");
        let steps = p.on_line(line(r#"{"id":2,"error":{"code":-32603,"message":"no auth"}}"#));
        assert!(sent(&steps).is_empty());
        let steps = p.send_message("again");
        assert!(sent(&steps).is_empty());
        assert!(matches!(events(&steps)[0], ChatEvent::TurnEnd { outcome: Outcome::Failed, .. }));
        assert_eq!(events(&steps)[1], &ChatEvent::Status { status: Status::Idle });
    }

    #[test]
    fn codex_failed_turn_start_reports_the_error() {
        let mut p = ready(Protocol::new(Agent::Codex, Some("t-1".into())));
        p.send_message("hi");
        let steps = p.on_line(line(r#"{"id":1,"error":{"code":-32600,"message":"thread not found"}}"#));
        assert!(matches!(events(&steps)[0], ChatEvent::TurnEnd { outcome: Outcome::Failed, error: Some(e), .. } if e == "turn/start: thread not found"));
    }
}
