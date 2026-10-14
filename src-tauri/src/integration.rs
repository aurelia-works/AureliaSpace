//! Installs the zsh integration and Claude Code hook files into the app dir, and
//! tails the hook events file, forwarding each event to the frontend.

use crate::config::app_dir;
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const ZSHENV: &str = include_str!("../resources/zshenv.zsh");
const ZSH_INTEGRATION: &str = include_str!("../resources/integration.zsh");
const HOOK_SH: &str = include_str!("../resources/hook.sh");
const STATUSLINE_SH: &str = include_str!("../resources/statusline.sh");

pub struct Paths {
    pub zdotdir: PathBuf,
    pub zsh_integration: PathBuf,
    pub claude_settings: PathBuf,
    pub claude_mcp: PathBuf,
    pub events_file: PathBuf,
}

pub fn paths() -> Paths {
    let dir = app_dir();
    Paths {
        zdotdir: dir.join("shell/zsh"),
        zsh_integration: dir.join("shell/aurelia-integration.zsh"),
        claude_settings: dir.join("hooks/claude-settings.json"),
        claude_mcp: dir.join("hooks/claude-mcp.json"),
        events_file: dir.join("run/agent-events.jsonl"),
    }
}

/// Settings passed to `claude --settings`: hooks for every event the agent panel derives
/// status from, and a status line that forwards Claude Code's own live numbers (rate
/// limits, context window, cache expiry, effort, cost) before running the user's.
fn claude_settings(hook_path: &str, statusline_path: &str) -> Value {
    let cmd = |event: &str| {
        json!([{ "matcher": "*", "hooks": [{
            "type": "command",
            "command": format!("sh '{hook_path}' {event}"),
            "timeout": 5
        }]}])
    };
    let plain = |event: &str| {
        json!([{ "hooks": [{
            "type": "command",
            "command": format!("sh '{hook_path}' {event}"),
            "timeout": 5
        }]}])
    };
    json!({
        "statusLine": { "type": "command", "command": format!("sh '{statusline_path}'"), "padding": 0 },
        "hooks": {
            "SessionStart": plain("SessionStart"),
            "UserPromptSubmit": plain("UserPromptSubmit"),
            "PreToolUse": cmd("PreToolUse"),
            "PostToolUse": cmd("PostToolUse"),
            "Notification": plain("Notification"),
            "Stop": plain("Stop"),
            "StopFailure": plain("StopFailure"),
            "SessionEnd": plain("SessionEnd")
        }
    })
}

/// Writes (overwrites) all integration files. Called on every launch so they track
/// the app version.
pub fn install() -> Result<(), String> {
    let p = paths();
    let hook_path = app_dir().join("hooks/aurelia-hook.sh");
    let statusline_path = app_dir().join("hooks/aurelia-statusline.sh");
    for dir in [&p.zdotdir, &app_dir().join("hooks"), &app_dir().join("run")] {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(p.zdotdir.join(".zshenv"), ZSHENV).map_err(|e| e.to_string())?;
    fs::write(&p.zsh_integration, ZSH_INTEGRATION).map_err(|e| e.to_string())?;
    fs::write(&hook_path, HOOK_SH).map_err(|e| e.to_string())?;
    fs::write(&statusline_path, STATUSLINE_SH).map_err(|e| e.to_string())?;
    let settings = claude_settings(&hook_path.to_string_lossy(), &statusline_path.to_string_lossy());
    fs::write(&p.claude_settings, serde_json::to_string_pretty(&settings).unwrap())
        .map_err(|e| e.to_string())?;
    // This binary is also the MCP server (`mcp` argument); it lists no tools while
    // subagents are off in Settings, so the file can stay put either way. The server
    // enforces the configured time limit itself; Claude's own timeout sits just above
    // the longest one Settings allows (120 min) so it never cuts a report short.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mcp = json!({ "mcpServers": { "aurelia": { "type": "stdio", "command": exe, "args": ["mcp"], "timeout": 121 * 60 * 1000 } } });
    fs::write(&p.claude_mcp, serde_json::to_string_pretty(&mcp).unwrap()).map_err(|e| e.to_string())?;
    // Events from a previous run matter only for panes still running in the terminal host.
    let alive = crate::ptyhost::list(&crate::ptyhost::socket_path());
    let kept = fs::read_to_string(&p.events_file).map(|s| events_of(&s, &alive)).unwrap_or_default();
    fs::write(&p.events_file, kept).map_err(|e| e.to_string())?;
    Ok(())
}

/// The last MAX_KEPT_EVENTS lines whose pane is in `alive`.
fn events_of(log: &str, alive: &[String]) -> String {
    const MAX_KEPT_EVENTS: usize = 4000;
    if alive.is_empty() {
        return String::new();
    }
    let lines: Vec<&str> = log
        .lines()
        .filter(|l| serde_json::from_str::<Value>(l).ok().and_then(|v| v["pane"].as_str().map(|p| alive.iter().any(|a| a == p))).unwrap_or(false))
        .collect();
    let skip = lines.len().saturating_sub(MAX_KEPT_EVENTS);
    lines[skip..].iter().map(|l| format!("{l}\n")).collect()
}

static FRONTEND_READY: AtomicBool = AtomicBool::new(false);

/// The frontend is listening for `agent-event`; the watcher starts emitting.
#[tauri::command]
pub fn agent_events_ready() {
    FRONTEND_READY.store(true, Ordering::SeqCst);
}

/// Polls the events file for appended lines and emits each as `agent-event`.
pub fn watch_events(app: AppHandle) {
    let path = paths().events_file;
    std::thread::spawn(move || {
        // Lines already there came from before this launch (see install): replayed once
        // the frontend listens, marked so they restore state without alerting anyone.
        let replay_end = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        while !FRONTEND_READY.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(50));
        }
        let mut offset: u64 = 0;
        let mut partial = String::new();
        loop {
            std::thread::sleep(Duration::from_millis(200));
            let Ok(mut file) = fs::File::open(&path) else { continue };
            let len = file.metadata().map(|m| m.len()).unwrap_or(0);
            if len < offset {
                // Truncated externally; start over.
                offset = 0;
                partial.clear();
            }
            if len == offset {
                continue;
            }
            if file.seek(SeekFrom::Start(offset)).is_err() {
                continue;
            }
            let mut buf = String::new();
            if file.read_to_string(&mut buf).is_err() {
                continue;
            }
            let start = offset - partial.len() as u64;
            offset += buf.len() as u64;
            partial.push_str(&buf);
            let mut consumed = start;
            while let Some(nl) = partial.find('\n') {
                let line: String = partial.drain(..=nl).collect();
                consumed += line.len() as u64;
                if let Ok(mut value) = serde_json::from_str::<Value>(line.trim()) {
                    if consumed <= replay_end {
                        value["replay"] = Value::Bool(true);
                    }
                    let _ = app.emit("agent-event", value);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_events_of_panes_that_survived() {
        let log = "{\"pane\":\"a\",\"event\":\"Stop\"}\n{\"pane\":\"b\",\"event\":\"Stop\"}\nnot json\n{\"pane\":\"a\",\"event\":\"UserPromptSubmit\"}\n";
        assert_eq!(events_of(log, &["a".into()]), "{\"pane\":\"a\",\"event\":\"Stop\"}\n{\"pane\":\"a\",\"event\":\"UserPromptSubmit\"}\n");
        assert_eq!(events_of(log, &[]), "");
    }
}
