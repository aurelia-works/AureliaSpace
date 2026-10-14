//! DeepSeek subagents for Claude panes. The app binary doubles as a small MCP server
//! (`aurelia-space mcp`, stdio) that every pane's `claude` gets through `--mcp-config`.
//! Its `deepseek_agent` tool hands one or two tasks to a fresh OpenCode agent running
//! DeepSeek v4.1 on the user's OpenCode Go plan, and returns that agent's final report.
//! Claude farms out research and mechanical edits without spending its own limits.
//!
//! Each run is `opencode run --standalone` with two app-defined agents injected through
//! `OPENCODE_CONFIG_CONTENT` (custom agents only load in a standalone server):
//! `aurelia-read` may only read, grep and glob; `aurelia-work` may also edit, write and
//! run shell commands, except destructive git and `rm -rf`, which are denied (an "ask"
//! rule would be auto-rejected in a headless run and abort the whole session).

use crate::{config, which};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

const TOOL: &str = "deepseek_agent";
/// Tasks one agent takes on; more go to more agents (called in parallel by Claude).
const MAX_TASKS: usize = 2;
const MAX_FILES: usize = 20;

const INSTRUCTIONS: &str = "deepseek_agent starts a separate DeepSeek v4.1 agent (OpenCode Go plan) in this folder. \
It does not use your Claude limits. Use it for self-contained work: finding and summarising code, answering questions \
about the codebase, drafting tests, mechanical edits across files. Give each agent at most 2 related tasks; for more, \
call the tool several times in parallel. It starts with no context, so put file paths, constraints and the expected \
output in the task or `context`. Mode is read-only unless you pass mode \"write\"; use write only for clearly specified \
edits and review its changes (git diff) before relying on them. Keep decisions that need this conversation's history.";

#[derive(Debug, Clone, Copy, PartialEq)]
enum Mode {
    Read,
    Write,
}

#[derive(Debug)]
struct Job {
    tasks: Vec<String>,
    context: Option<String>,
    mode: Mode,
    files: Vec<String>,
    effort: Option<&'static str>,
    session: Option<String>,
}

fn tool_schema() -> Value {
    json!({
        "name": TOOL,
        "title": "DeepSeek subagent",
        "description": "Run a DeepSeek v4.1 agent (via OpenCode Go, not your Claude limits) on 1-2 self-contained tasks in the \
current folder and get its final report back. Read-only by default; mode \"write\" lets it edit files and run commands \
(destructive git and rm -rf are blocked). It knows nothing about this conversation: say exactly what to look at and what \
to return. Pass the returned session id as `session` to ask the same agent a follow-up.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tasks": {
                    "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": MAX_TASKS,
                    "description": "One or two tasks for this agent. For more, call the tool again in parallel."
                },
                "context": { "type": "string", "description": "Background the agent needs: relevant files, decisions, constraints." },
                "mode": { "type": "string", "enum": ["read", "write"], "description": "read (default): read and search only. write: may edit files and run commands." },
                "files": { "type": "array", "items": { "type": "string" }, "maxItems": MAX_FILES, "description": "Files to attach to the first message." },
                "effort": { "type": "string", "enum": ["low", "high"], "description": "Reasoning effort; omit for the model's default." },
                "session": { "type": "string", "description": "Session id from an earlier result, to continue that agent." }
            },
            "required": ["tasks"]
        },
        "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": true }
    })
}

fn parse_job(args: &Value) -> Result<Job, String> {
    let tasks: Vec<String> = args["tasks"]
        .as_array()
        .ok_or("`tasks` must be a list of 1-2 task descriptions")?
        .iter()
        .filter_map(|t| t.as_str().map(str::trim).filter(|t| !t.is_empty()).map(String::from))
        .collect();
    if tasks.is_empty() {
        return Err("`tasks` must hold at least one non-empty task".into());
    }
    if tasks.len() > MAX_TASKS {
        return Err(format!(
            "Give each DeepSeek agent at most {MAX_TASKS} tasks ({} given). Call {TOOL} again, in parallel, for the rest.",
            tasks.len()
        ));
    }
    let mode = match args["mode"].as_str().unwrap_or("read") {
        "read" => Mode::Read,
        "write" => Mode::Write,
        other => return Err(format!("unknown mode {other:?}; use \"read\" or \"write\"")),
    };
    let effort = match args["effort"].as_str() {
        None => None,
        Some("low") => Some("low"),
        Some("high") => Some("high"),
        Some(other) => return Err(format!("unknown effort {other:?}; use \"low\" or \"high\"")),
    };
    let session = args["session"].as_str().map(str::trim).filter(|s| !s.is_empty());
    if let Some(s) = session {
        if !s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
            return Err("`session` must be a session id from an earlier result".into());
        }
    }
    let files: Vec<String> = args["files"]
        .as_array()
        .map(|a| a.iter().filter_map(|f| f.as_str().map(str::trim).filter(|f| !f.is_empty()).map(String::from)).collect())
        .unwrap_or_default();
    if files.len() > MAX_FILES {
        return Err(format!("attach at most {MAX_FILES} files"));
    }
    Ok(Job {
        tasks,
        context: args["context"].as_str().map(str::trim).filter(|c| !c.is_empty()).map(String::from),
        mode,
        files,
        effort,
        session: session.map(String::from),
    })
}

/// The first message. Custom agent prompts aren't applied by `opencode run`, so the
/// subagent's brief travels with the task.
fn prompt(job: &Job, cwd: &str) -> String {
    let mut p = format!(
        "You are a subagent for another coding agent, which reads only your final message. Work in {cwd}.\n{}\n\
Finish with a short report: what you found or changed, with file:line references. No preamble, no offers of further help.\n",
        match job.mode {
            Mode::Read => "You can read and search files but not change them.",
            Mode::Write => "You may edit files and run commands. Destructive git commands and rm -rf are blocked. Change only what the tasks need.",
        }
    );
    if let Some(c) = &job.context {
        p.push_str(&format!("\nContext:\n{c}\n"));
    }
    if job.tasks.len() == 1 {
        p.push_str(&format!("\nTask:\n{}\n", job.tasks[0]));
    } else {
        for (i, t) in job.tasks.iter().enumerate() {
            p.push_str(&format!("\nTask {}:\n{t}\n", i + 1));
        }
    }
    p
}

fn agent_config() -> String {
    let rule = |action: &str, resource: &str, effect: &str| json!({ "action": action, "resource": resource, "effect": effect });
    let read = ["read", "grep", "glob"].map(|a| rule(a, "*", "allow"));
    let mut read_rules = vec![rule("*", "*", "deny")];
    read_rules.extend(read.clone());
    let mut work_rules = read_rules.clone();
    work_rules.extend(["edit", "write", "shell"].map(|a| rule(a, "*", "allow")));
    for cmd in ["git push*", "git reset --hard*", "git clean*", "git checkout -- *", "git restore *", "rm -rf *", "rm -fr *", "sudo *"] {
        work_rules.push(rule("shell", cmd, "deny"));
    }
    json!({
        "agents": {
            "aurelia-read": { "description": "Read-only subagent for Claude Code in AureliaSpace", "mode": "primary", "steps": 40, "permissions": read_rules },
            "aurelia-work": { "description": "Editing subagent for Claude Code in AureliaSpace", "mode": "primary", "steps": 60, "permissions": work_rules }
        }
    })
    .to_string()
}

fn model_for(model: &str, effort: Option<&str>) -> String {
    match effort {
        Some(e) if !model.contains('#') => format!("{model}#{e}"),
        _ => model.to_string(),
    }
}

fn command(bin: &Path, model: &str, job: &Job, cwd: &str) -> Command {
    let mut cmd = Command::new(bin);
    cmd.args(["run", "--standalone", "--format", "json", "-m"])
        .arg(model_for(model, job.effort))
        .arg("--agent")
        .arg(if job.mode == Mode::Write { "aurelia-work" } else { "aurelia-read" });
    if let Some(s) = &job.session {
        cmd.arg("--session").arg(s);
    } else {
        let first: String = job.tasks[0].chars().take(60).collect();
        cmd.arg("--title").arg(format!("Claude subagent: {first}"));
    }
    for f in &job.files {
        cmd.arg("--file").arg(f);
    }
    cmd.arg(prompt(job, cwd))
        .current_dir(cwd)
        .env("OPENCODE_CONFIG_CONTENT", agent_config())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Its own process group, so `stop` also ends the commands the agent started.
        .process_group(0);
    cmd
}

/// Ends an agent and everything it started: a shell command left running would keep
/// the output pipe open and the report would never finish.
fn stop(child: &mut Child) {
    let _ = Command::new("/bin/kill").args(["-KILL", &format!("-{}", child.id())]).status();
    let _ = child.kill();
}

/// What the agent did, folded from `opencode run --format json` events.
#[derive(Default, Debug)]
struct Report {
    /// The agent's folder; paths under it are shown relative.
    root: String,
    session: Option<String>,
    /// Text of the latest assistant message: its final answer once the run ends.
    message: Option<String>,
    text: String,
    tools: usize,
    changed: Vec<String>,
    blocked: Vec<String>,
    error: Option<String>,
}

fn relative<'a>(path: &'a str, root: &str) -> &'a str {
    path.strip_prefix(root).and_then(|p| p.strip_prefix('/')).filter(|p| !p.is_empty()).unwrap_or(path)
}

fn tool_summary(tool: &str, input: &Value, root: &str) -> String {
    let arg = ["path", "filePath", "command", "pattern"]
        .iter()
        .find_map(|k| input.get(*k).and_then(Value::as_str))
        .unwrap_or("");
    let arg: String = relative(arg, root).to_string();
    let arg: String = arg.lines().next().unwrap_or("").chars().take(80).collect();
    if arg.is_empty() { tool.to_string() } else { format!("{tool} {arg}") }
}

impl Report {
    /// Folds one event line; returns a progress note for a finished tool call.
    fn fold(&mut self, line: &str) -> Option<String> {
        let ev: Value = serde_json::from_str(line.trim()).ok()?;
        if let Some(s) = ev["sessionID"].as_str() {
            self.session.get_or_insert_with(|| s.to_string());
        }
        let part = &ev["part"];
        match ev["type"].as_str()? {
            "text" => {
                let msg = part["messageID"].as_str().map(String::from);
                if msg != self.message {
                    self.message = msg;
                    self.text.clear();
                }
                let t = part["text"].as_str().unwrap_or("").trim();
                if !t.is_empty() {
                    if !self.text.is_empty() {
                        self.text.push_str("\n\n");
                    }
                    self.text.push_str(t);
                }
                None
            }
            "tool_use" => {
                let tool = part["tool"].as_str().unwrap_or("tool");
                let state = &part["state"];
                let summary = tool_summary(tool, &state["input"], &self.root);
                self.tools += 1;
                match state["status"].as_str() {
                    Some("completed") if matches!(tool, "edit" | "write" | "patch") => {
                        if let Some(p) = ["path", "filePath"].iter().find_map(|k| state["input"][*k].as_str()) {
                            let p = relative(p, &self.root);
                            if !self.changed.iter().any(|c| c == p) {
                                self.changed.push(p.to_string());
                            }
                        }
                    }
                    Some("error") if state["error"].as_str().is_some_and(|e| e.contains("Permission denied")) => {
                        self.blocked.push(summary.clone());
                    }
                    _ => {}
                }
                Some(summary)
            }
            "error" => {
                let e = &ev["error"];
                self.error = Some(e["message"].as_str().or(e["type"].as_str()).unwrap_or("unknown error").to_string());
                None
            }
            _ => None,
        }
    }
}

struct Outcome {
    report: Report,
    elapsed: Duration,
    timed_out: bool,
    exit_ok: bool,
    stderr: String,
}

fn render(o: &Outcome, model: &str, mode: Mode) -> (String, bool) {
    let r = &o.report;
    let mut out = if r.text.is_empty() { "(The agent returned no report.)".to_string() } else { r.text.clone() };
    out.push_str(&format!(
        "\n\n---\nDeepSeek agent · {model} · {} · {} tool call{} · {:.1}s",
        if mode == Mode::Write { "write" } else { "read-only" },
        r.tools,
        if r.tools == 1 { "" } else { "s" },
        o.elapsed.as_secs_f64()
    ));
    if let Some(s) = &r.session {
        out.push_str(&format!(" · session {s}"));
    }
    if !r.changed.is_empty() {
        out.push_str(&format!("\nChanged: {}", r.changed.join(", ")));
    }
    if !r.blocked.is_empty() {
        out.push_str(&format!("\nBlocked: {}", r.blocked.join("; ")));
    }
    let failed = o.timed_out || r.error.is_some() || !o.exit_ok;
    if o.timed_out {
        out.push_str("\nStopped: it ran past the time limit (Settings → General → DeepSeek subagents).");
    } else if let Some(e) = &r.error {
        out.push_str(&format!("\nStopped: {e}"));
    } else if !o.exit_ok {
        out.push_str("\nStopped: opencode exited with an error.");
    }
    if failed && !o.stderr.is_empty() {
        out.push_str(&format!("\nopencode said:\n{}", o.stderr));
    }
    (out, failed && r.text.is_empty())
}

type Running = Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>;

fn run_job(bin: &Path, model: &str, job: &Job, cwd: &str, limit: Duration, key: &str, running: &Running, mut progress: impl FnMut(usize, &str)) -> Result<Outcome, String> {
    let started = Instant::now();
    let mut child = command(bin, model, job, cwd).spawn().map_err(|e| format!("could not start opencode: {e}"))?;
    let stdout = child.stdout.take().ok_or("opencode has no stdout")?;
    let stderr = child.stderr.take().ok_or("opencode has no stderr")?;
    let child = Arc::new(Mutex::new(child));
    running.lock().unwrap().insert(key.to_string(), child.clone());

    // Drained on its own thread so a chatty stderr can't fill the pipe and stall the run.
    let err_tail = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut s);
        let lines: Vec<&str> = s.lines().map(str::trim).filter(|l| !l.is_empty() && !l.contains("cwd was reset")).collect();
        lines[lines.len().saturating_sub(8)..].join("\n")
    });

    let (done_tx, done_rx) = mpsc::channel::<()>();
    let watchdog = {
        let child = child.clone();
        std::thread::spawn(move || {
            if done_rx.recv_timeout(limit) == Err(mpsc::RecvTimeoutError::Timeout) {
                stop(&mut child.lock().unwrap());
                return true;
            }
            false
        })
    };

    let mut report = Report { root: cwd.to_string(), ..Default::default() };
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        if let Some(note) = report.fold(&line) {
            progress(report.tools, &note);
        }
    }
    // Polled rather than `wait`ed so the lock stays free for the watchdog and cancellation.
    let status = loop {
        match child.lock().unwrap().try_wait() {
            Ok(Some(st)) => break Ok(st),
            Ok(None) => {}
            Err(e) => break Err(e),
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let _ = done_tx.send(());
    let timed_out = watchdog.join().unwrap_or(false);
    running.lock().unwrap().remove(key);
    Ok(Outcome {
        report,
        elapsed: started.elapsed(),
        timed_out,
        exit_ok: status.map(|s| s.success()).unwrap_or(false),
        stderr: err_tail.join().unwrap_or_default(),
    })
}

fn id_key(id: &Value) -> String {
    id.to_string()
}

type Out = Arc<Mutex<std::io::Stdout>>;

fn send(out: &Out, msg: Value) {
    let mut o = out.lock().unwrap();
    let _ = writeln!(o, "{msg}");
    let _ = o.flush();
}

fn initialize(params: &Value) -> Value {
    json!({
        "protocolVersion": params["protocolVersion"].as_str().unwrap_or("2025-06-18"),
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "aurelia", "title": "AureliaSpace", "version": env!("CARGO_PKG_VERSION") },
        "instructions": INSTRUCTIONS
    })
}

/// Where the tool can run from: off in Settings or no `opencode` means no tool at all,
/// so Claude never sees one it can't use.
fn available() -> Option<(PathBuf, config::SubagentsConfig)> {
    let cfg = config::load().subagents;
    // Subagents are for cheap models; Opus is never one of them.
    if !cfg.enabled || cfg.model.trim().is_empty() || cfg.model.to_ascii_lowercase().contains("opus") {
        return None;
    }
    Some((which::locate("opencode")?, cfg))
}

fn call(params: &Value, key: &str, running: &Running, out: &Out) -> Value {
    let error = |text: String| json!({ "content": [{ "type": "text", "text": text }], "isError": true });
    if params["name"].as_str() != Some(TOOL) {
        return error(format!("unknown tool {:?}", params["name"]));
    }
    let Some((bin, cfg)) = available() else {
        return error("DeepSeek subagents are off, set to an Opus model, or opencode isn't installed.".into());
    };
    let job = match parse_job(&params["arguments"]) {
        Ok(j) => j,
        Err(e) => return error(e),
    };
    let cwd = std::env::current_dir().map(|d| d.to_string_lossy().into_owned()).unwrap_or_else(|_| ".".into());
    let token = params["_meta"]["progressToken"].clone();
    let limit = Duration::from_secs(cfg.timeout_minutes.max(1) * 60);
    let progress = |n: usize, note: &str| {
        if !token.is_null() {
            send(out, json!({ "jsonrpc": "2.0", "method": "notifications/progress",
                "params": { "progressToken": token, "progress": n, "message": note } }));
        }
    };
    match run_job(&bin, cfg.model.trim(), &job, &cwd, limit, key, running, progress) {
        Ok(o) => {
            let (text, failed) = render(&o, cfg.model.trim(), job.mode);
            json!({ "content": [{ "type": "text", "text": text }], "isError": failed })
        }
        Err(e) => error(e),
    }
}

/// `aurelia-space mcp`: serves MCP over stdio until the client closes stdin.
pub fn serve() {
    let out: Out = Arc::new(Mutex::new(std::io::stdout()));
    let running: Running = Default::default();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        let method = msg["method"].as_str().unwrap_or("");
        let id = msg.get("id").filter(|v| !v.is_null()).cloned();
        let reply = |result: Value| json!({ "jsonrpc": "2.0", "id": id.clone(), "result": result });
        match (method, &id) {
            ("initialize", Some(_)) => send(&out, reply(initialize(&msg["params"]))),
            ("ping", Some(_)) => send(&out, reply(json!({}))),
            ("tools/list", Some(_)) => {
                let tools = if available().is_some() { vec![tool_schema()] } else { vec![] };
                send(&out, reply(json!({ "tools": tools })));
            }
            ("tools/call", Some(id)) => {
                let (id, params, out, running) = (id.clone(), msg["params"].clone(), out.clone(), running.clone());
                // Agents run concurrently: Claude may start several in parallel.
                std::thread::spawn(move || {
                    let result = call(&params, &id_key(&id), &running, &out);
                    send(&out, json!({ "jsonrpc": "2.0", "id": id, "result": result }));
                });
            }
            ("notifications/cancelled", None) => {
                if let Some(child) = running.lock().unwrap().get(&id_key(&msg["params"]["requestId"])) {
                    stop(&mut child.lock().unwrap());
                }
            }
            (_, Some(_)) if !method.is_empty() => send(
                &out,
                json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("method not found: {method}") } }),
            ),
            _ => {}
        }
    }
    // Claude is gone: nobody will read these agents' reports.
    for child in running.lock().unwrap().values() {
        stop(&mut child.lock().unwrap());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(args: Value) -> Job {
        parse_job(&args).unwrap()
    }

    #[test]
    fn caps_each_agent_at_two_tasks() {
        let err = parse_job(&json!({ "tasks": ["a", "b", "c"] })).unwrap_err();
        assert!(err.contains("at most 2"), "{err}");
        assert!(parse_job(&json!({ "tasks": [] })).is_err());
        assert!(parse_job(&json!({ "tasks": ["  "] })).is_err());
        assert!(parse_job(&json!({ "tasks": "a" })).is_err());
        assert_eq!(job(json!({ "tasks": ["a", "b"] })).tasks.len(), 2);
    }

    #[test]
    fn defaults_to_read_only_and_rejects_odd_values() {
        let j = job(json!({ "tasks": ["x"] }));
        assert_eq!(j.mode, Mode::Read);
        assert!(j.effort.is_none() && j.session.is_none() && j.files.is_empty());
        assert_eq!(job(json!({ "tasks": ["x"], "mode": "write" })).mode, Mode::Write);
        assert!(parse_job(&json!({ "tasks": ["x"], "mode": "yolo" })).is_err());
        assert!(parse_job(&json!({ "tasks": ["x"], "effort": "max" })).is_err());
        assert!(parse_job(&json!({ "tasks": ["x"], "session": "ses_1; rm -rf ~" })).is_err());
    }

    #[test]
    fn effort_becomes_a_model_variant_unless_one_is_set() {
        assert_eq!(model_for("opencode-go/deepseek-v4.1-flash", Some("high")), "opencode-go/deepseek-v4.1-flash#high");
        assert_eq!(model_for("opencode-go/deepseek-v4.1-flash#low", Some("high")), "opencode-go/deepseek-v4.1-flash#low");
        assert_eq!(model_for("opencode-go/deepseek-v4.1-flash", None), "opencode-go/deepseek-v4.1-flash");
    }

    #[test]
    fn prompt_carries_mode_context_and_numbered_tasks() {
        let p = prompt(&job(json!({ "tasks": ["find X", "fix Y"], "context": "repo is Rust" })), "/w");
        assert!(p.contains("Work in /w") && p.contains("not change them"));
        assert!(p.contains("Context:\nrepo is Rust") && p.contains("Task 1:\nfind X") && p.contains("Task 2:\nfix Y"));
        let w = prompt(&job(json!({ "tasks": ["one"], "mode": "write" })), "/w");
        assert!(w.contains("Task:\none") && w.contains("rm -rf are blocked"));
    }

    #[test]
    fn read_agent_only_reads_and_work_agent_blocks_destructive_commands() {
        let cfg: Value = serde_json::from_str(&agent_config()).unwrap();
        let read = cfg["agents"]["aurelia-read"]["permissions"].as_array().unwrap();
        assert_eq!(read[0], json!({ "action": "*", "resource": "*", "effect": "deny" }));
        let allowed: Vec<&str> = read.iter().filter(|r| r["effect"] == "allow").filter_map(|r| r["action"].as_str()).collect();
        assert_eq!(allowed, ["read", "grep", "glob"]);
        let work = cfg["agents"]["aurelia-work"]["permissions"].as_array().unwrap();
        // Later rules win, so the denials must come after the blanket shell allow.
        let shell_allow = work.iter().position(|r| r["action"] == "shell" && r["effect"] == "allow").unwrap();
        let push_deny = work.iter().position(|r| r["resource"] == "git push*").unwrap();
        assert!(push_deny > shell_allow);
        assert!(!work.iter().any(|r| r["action"] == "execute" && r["effect"] == "allow"));
    }

    // Trimmed from a real `opencode run --format json` session.
    const EVENTS: &[&str] = &[
        r#"{"type":"step_start","sessionID":"ses_abc","part":{"type":"step-start"}}"#,
        r#"{"type":"text","sessionID":"ses_abc","part":{"messageID":"msg_1","type":"text","text":"I'll take a look at the file."}}"#,
        r#"{"type":"tool_use","sessionID":"ses_abc","part":{"messageID":"msg_1","type":"tool","tool":"read","state":{"status":"completed","input":{"path":"calc.py"},"output":"1: def add"}}}"#,
        r#"{"type":"tool_use","sessionID":"ses_abc","part":{"messageID":"msg_2","type":"tool","tool":"write","state":{"status":"completed","input":{"path":"sub.py","content":"def sub"}}}}"#,
        r#"{"type":"tool_use","sessionID":"ses_abc","part":{"messageID":"msg_2","type":"tool","tool":"shell","state":{"status":"error","input":{"command":"git clean -n ."},"error":"Permission denied: shell"}}}"#,
        r#"{"type":"step_finish","sessionID":"ses_abc","part":{"type":"step-finish","reason":"tool-calls"}}"#,
        r#"{"type":"tool_use","sessionID":"ses_abc","part":{"messageID":"msg_2","type":"tool","tool":"read","state":{"status":"completed","input":{"path":"/w/lib/x.rs"}}}}"#,
        r#"{"type":"text","sessionID":"ses_abc","part":{"messageID":"msg_3","type":"text","text":"add() subtracts; fixed in calc.py:2."}}"#,
        "not json",
    ];

    #[test]
    fn report_keeps_the_final_message_and_what_changed() {
        let mut r = Report { root: "/w".into(), ..Default::default() };
        let notes: Vec<String> = EVENTS.iter().filter_map(|l| r.fold(l)).collect();
        assert_eq!(notes, ["read calc.py", "write sub.py", "shell git clean -n .", "read lib/x.rs"]);
        assert_eq!(r.session.as_deref(), Some("ses_abc"));
        assert_eq!(r.text, "add() subtracts; fixed in calc.py:2.");
        assert_eq!(r.tools, 4);
        assert_eq!(r.changed, ["sub.py"]);
        assert_eq!(r.blocked, ["shell git clean -n ."]);
        assert!(r.error.is_none());
    }

    #[test]
    fn report_records_a_session_error() {
        let mut r = Report::default();
        r.fold(r#"{"type":"error","sessionID":"ses_x","error":{"type":"unknown","message":"Agent not found: \"x\""}}"#);
        let o = Outcome { report: r, elapsed: Duration::from_secs(1), timed_out: false, exit_ok: false, stderr: "boom".into() };
        let (text, failed) = render(&o, "m", Mode::Read);
        assert!(failed);
        assert!(text.contains("Stopped: Agent not found") && text.contains("opencode said:\nboom"), "{text}");
    }

    fn fake_opencode(dir: &Path, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let bin = dir.join("opencode");
        std::fs::write(&bin, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("aurelia-subagents-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn runs_opencode_with_the_agent_model_and_prompt() {
        let dir = scratch("run");
        let d = dir.to_str().unwrap();
        // Records its argv, cwd and injected config, then plays back a short session.
        let bin = fake_opencode(
            &dir,
            &format!(
                r#"printf '%s\n' "$@" > '{d}/argv'; pwd > '{d}/cwd'; printf '%s' "$OPENCODE_CONFIG_CONTENT" > '{d}/cfg'
printf '{{"type":"tool_use","sessionID":"ses_t","part":{{"tool":"read","state":{{"status":"completed","input":{{"path":"a.rs"}}}}}}}}\n'
printf '{{"type":"text","sessionID":"ses_t","part":{{"messageID":"m","text":"done"}}}}\n'"#
            ),
        );
        let running: Running = Default::default();
        let mut notes = vec![];
        let j = job(json!({ "tasks": ["look at a.rs"], "effort": "high", "files": ["a.rs"] }));
        let o = run_job(&bin, "opencode-go/deepseek-v4.1-flash", &j, d, Duration::from_secs(20), "1", &running, |n, s| notes.push(format!("{n}:{s}"))).unwrap();
        assert!(o.exit_ok && !o.timed_out);
        assert_eq!(notes, ["1:read a.rs"]);
        assert_eq!(o.report.text, "done");
        assert_eq!(o.report.session.as_deref(), Some("ses_t"));
        let argv = std::fs::read_to_string(dir.join("argv")).unwrap();
        let expected = "run\n--standalone\n--format\njson\n-m\nopencode-go/deepseek-v4.1-flash#high\n--agent\naurelia-read\n--title\nClaude subagent: look at a.rs\n--file\na.rs\nYou are a subagent";
        assert!(argv.starts_with(expected), "{argv}");
        assert!(argv.contains("Task:\nlook at a.rs"), "{argv}");
        let cwd = std::fs::read_to_string(dir.join("cwd")).unwrap();
        assert!(cwd.trim().ends_with(dir.file_name().unwrap().to_str().unwrap()), "{cwd}");
        let cfg: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("cfg")).unwrap()).unwrap();
        assert!(cfg["agents"]["aurelia-read"].is_object() && cfg["agents"]["aurelia-work"].is_object());
        assert!(running.lock().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stops_an_agent_that_runs_past_the_limit() {
        let dir = scratch("slow");
        // The sleep is a separate process holding stdout open, like a command the agent left running.
        let bin = fake_opencode(&dir, r#"printf '{"type":"text","sessionID":"s","part":{"messageID":"m","text":"partial"}}\n'; sleep 30; echo late"#);
        let running: Running = Default::default();
        let started = Instant::now();
        let o = run_job(&bin, "m", &job(json!({ "tasks": ["t"] })), dir.to_str().unwrap(), Duration::from_millis(500), "2", &running, |_, _| {}).unwrap();
        assert!(o.timed_out && started.elapsed() < Duration::from_secs(10));
        let (text, failed) = render(&o, "m", Mode::Read);
        assert!(!failed, "a partial report is still returned");
        assert!(text.starts_with("partial") && text.contains("time limit"), "{text}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn lists_the_tool_with_a_two_task_cap() {
        let s = tool_schema();
        assert_eq!(s["name"], TOOL);
        assert_eq!(s["inputSchema"]["properties"]["tasks"]["maxItems"], 2);
        assert_eq!(initialize(&json!({ "protocolVersion": "2025-11-25" }))["protocolVersion"], "2025-11-25");
    }
}
