//! Installs the zsh integration and Claude Code hook files into the app dir, and
//! tails the hook events file, forwarding each event to the frontend.

use crate::config::app_dir;
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const ZSHENV: &str = include_str!("../resources/zshenv.zsh");
const ZSH_INTEGRATION: &str = include_str!("../resources/integration.zsh");
const HOOK_SH: &str = include_str!("../resources/hook.sh");

pub struct Paths {
    pub zdotdir: PathBuf,
    pub zsh_integration: PathBuf,
    pub claude_settings: PathBuf,
    pub events_file: PathBuf,
}

pub fn paths() -> Paths {
    let dir = app_dir();
    Paths {
        zdotdir: dir.join("shell/zsh"),
        zsh_integration: dir.join("shell/aurelia-integration.zsh"),
        claude_settings: dir.join("hooks/claude-settings.json"),
        events_file: dir.join("run/agent-events.jsonl"),
    }
}

/// Hook settings passed to `claude --settings`. Covers every event the agent panel
/// derives status from.
fn claude_settings(hook_path: &str) -> Value {
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
        "hooks": {
            "SessionStart": plain("SessionStart"),
            "UserPromptSubmit": plain("UserPromptSubmit"),
            "PreToolUse": cmd("PreToolUse"),
            "PostToolUse": cmd("PostToolUse"),
            "Notification": plain("Notification"),
            "Stop": plain("Stop"),
            "SessionEnd": plain("SessionEnd")
        }
    })
}

/// Writes (overwrites) all integration files. Called on every launch so they track
/// the app version.
pub fn install() -> Result<(), String> {
    let p = paths();
    let hook_path = app_dir().join("hooks/aurelia-hook.sh");
    for dir in [&p.zdotdir, &app_dir().join("hooks"), &app_dir().join("run")] {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(p.zdotdir.join(".zshenv"), ZSHENV).map_err(|e| e.to_string())?;
    fs::write(&p.zsh_integration, ZSH_INTEGRATION).map_err(|e| e.to_string())?;
    fs::write(&hook_path, HOOK_SH).map_err(|e| e.to_string())?;
    let settings = claude_settings(&hook_path.to_string_lossy());
    fs::write(&p.claude_settings, serde_json::to_string_pretty(&settings).unwrap())
        .map_err(|e| e.to_string())?;
    // Events from a previous run refer to panes that no longer exist.
    fs::write(&p.events_file, "").map_err(|e| e.to_string())?;
    Ok(())
}

/// Polls the events file for appended lines and emits each as `agent-event`.
pub fn watch_events(app: AppHandle) {
    let path = paths().events_file;
    std::thread::spawn(move || {
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
            offset += buf.len() as u64;
            partial.push_str(&buf);
            while let Some(nl) = partial.find('\n') {
                let line: String = partial.drain(..=nl).collect();
                if let Ok(value) = serde_json::from_str::<Value>(line.trim()) {
                    let _ = app.emit("agent-event", value);
                }
            }
        }
    });
}
