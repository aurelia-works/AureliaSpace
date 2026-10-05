//! Receives dictation from Aurelia Voice over a unix socket
//! (`~/Library/Application Support/AureliaSpace/voice.sock`). Each connection sends
//! JSON lines: `{"type":"transcript","text":"..."}` or `{"type":"state","state":"..."}`,
//! forwarded to the frontend as `voice-transcript` / `voice-state` events.

use crate::config::app_dir;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Emitter};

const APP_PATH: &str = "/Applications/Aurelia Voice.app";
const BUNDLE_ID: &str = "com.aurelia.AureliaVoice";

pub fn socket_path() -> PathBuf {
    app_dir().join("voice.sock")
}

/// Binds the voice socket (removing a stale file) and serves it on background threads.
pub fn listen(app: AppHandle) {
    let path = socket_path();
    let _ = std::fs::create_dir_all(app_dir());
    let _ = std::fs::remove_file(&path);
    let listener = match UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[aurelia] voice socket unavailable: {e}");
            return;
        }
    };
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let app = app.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stream).lines() {
                    let Ok(line) = line else { break };
                    let Ok(value) = serde_json::from_str::<Value>(line.trim()) else { continue };
                    match value.get("type").and_then(Value::as_str) {
                        Some("transcript") => {
                            let _ = app.emit("voice-transcript", value);
                        }
                        Some("state") => {
                            let _ = app.emit("voice-state", value);
                        }
                        _ => {}
                    }
                }
            });
        }
    });
}

/// Removes the socket so Aurelia Voice falls back to pasting once we are gone.
pub fn cleanup() {
    let _ = std::fs::remove_file(socket_path());
}

/// Starts or stops a dictation in Aurelia Voice (same as its hotkey). `-g` keeps
/// AureliaSpace frontmost, which is how Aurelia Voice recognises the target.
#[tauri::command]
pub fn voice_toggle() -> Result<(), String> {
    Command::new("open")
        .args(["-g", "aureliavoice://toggle"])
        .status()
        .map_err(|e| e.to_string())
        .and_then(|s| if s.success() { Ok(()) } else { Err("open failed".into()) })
}

#[tauri::command]
pub fn voice_installed() -> bool {
    if std::path::Path::new(APP_PATH).exists() {
        return true;
    }
    Command::new("mdfind")
        .arg(format!("kMDItemCFBundleIdentifier == '{BUNDLE_ID}'"))
        .output()
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false)
}
