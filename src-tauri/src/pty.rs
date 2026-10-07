//! One PTY per pane. Output is streamed to the frontend as raw bytes over a Tauri
//! channel, coalesced into small batches so busy panes don't flood the IPC bridge.

use crate::config;
use crate::integration;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State};

const READ_BUF: usize = 64 * 1024;
const BATCH_WINDOW: Duration = Duration::from_millis(3);
const BATCH_MAX: usize = 512 * 1024;

struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Bumped on respawn so a stale reader thread doesn't report the new session's exit.
    generation: u64,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<String, Arc<Mutex<Session>>>>,
    generation: Mutex<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExit {
    pane_id: String,
    code: Option<u32>,
}

fn default_shell(cfg: &config::Config) -> String {
    if !cfg.terminal.shell.is_empty() {
        return config::expand_path(&cfg.terminal.shell);
    }
    std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into())
}

fn build_command(
    pane_id: &str,
    cwd: Option<String>,
    account: Option<String>,
    env: Option<HashMap<String, String>>,
    secret_env: Option<HashMap<String, String>>,
) -> Result<CommandBuilder, String> {
    let cfg = config::load();
    let shell = default_shell(&cfg);
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");

    let dir = cwd
        .or_else(|| Some(cfg.default_workspace.clone()).filter(|w| !w.is_empty()))
        .map(|c| config::expand_path(&c))
        .filter(|c| Path::new(c).is_dir())
        .unwrap_or_else(|| config::home_dir().to_string_lossy().into_owned());
    cmd.cwd(dir);

    // Don't leak the environment of whatever launched the app (e.g. a Claude Code
    // session during development) into the panes.
    for var in ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CONFIG_DIR", "TERM_PROGRAM_VERSION"] {
        cmd.env_remove(var);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "AureliaSpace");
    if std::env::var("LANG").map(|v| v.is_empty()).unwrap_or(true) {
        cmd.env("LANG", "en_US.UTF-8");
    }

    let paths = integration::paths();
    cmd.env("AURELIA_PANE_ID", pane_id);
    cmd.env("AURELIA_EVENTS_FILE", &paths.events_file);
    cmd.env("AURELIA_CLAUDE_SETTINGS", &paths.claude_settings);

    // Shell integration via ZDOTDIR (zsh only; other shells run without blocks).
    if Path::new(&shell).file_name().is_some_and(|n| n == "zsh") {
        if let Ok(orig) = std::env::var("ZDOTDIR") {
            cmd.env("AURELIA_ORIG_ZDOTDIR", orig);
        }
        cmd.env("ZDOTDIR", &paths.zdotdir);
        cmd.env("AURELIA_ZSH_INTEGRATION", &paths.zsh_integration);
    }

    if let Some(name) = account {
        let acct = cfg
            .accounts
            .iter()
            .find(|a| a.name == name)
            .ok_or_else(|| format!("unknown account '{name}'"))?;
        if !acct.is_default() {
            cmd.env("CLAUDE_CONFIG_DIR", acct.resolved_dir());
        }
        cmd.env("AURELIA_ACCOUNT", &acct.name);
    }
    // Agent CLI settings (e.g. an API key from the Keychain) go in last so they win.
    for (k, v) in crate::agents::resolve_env(env, secret_env)? {
        cmd.env(k, v);
    }
    Ok(cmd)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    pane_id: String,
    cwd: Option<String>,
    account: Option<String>,
    env: Option<HashMap<String, String>>,
    secret_env: Option<HashMap<String, String>>,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    // A webview reload re-spawns existing panes; replace the old process.
    if let Some(old) = state.sessions.lock().unwrap().remove(&pane_id) {
        let _ = old.lock().unwrap().child.kill();
    }

    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let cmd = build_command(&pane_id, cwd, account, env, secret_env)?;
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave); // so the reader sees EOF when the shell exits

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let generation = {
        let mut g = state.generation.lock().unwrap();
        *g += 1;
        *g
    };
    let session = Arc::new(Mutex::new(Session { writer, master: pair.master, child, generation }));
    state.sessions.lock().unwrap().insert(pane_id.clone(), session.clone());

    let (tx, rx) = mpsc::channel::<Vec<u8>>();

    std::thread::spawn(move || {
        let mut buf = vec![0u8; READ_BUF];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
    });

    std::thread::spawn(move || {
        'outer: while let Ok(first) = rx.recv() {
            let mut out = first;
            let deadline = Instant::now() + BATCH_WINDOW;
            while out.len() < BATCH_MAX {
                match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                    Ok(chunk) => out.extend_from_slice(&chunk),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => {
                        let _ = on_data.send(InvokeResponseBody::Raw(out));
                        break 'outer;
                    }
                }
            }
            if on_data.send(InvokeResponseBody::Raw(out)).is_err() {
                break;
            }
        }

        let code = {
            let mut s = session.lock().unwrap();
            s.child.wait().ok().map(|st| st.exit_code())
        };
        let state = app.state::<PtyState>();
        let mut sessions = state.sessions.lock().unwrap();
        let current = sessions.get(&pane_id).map(|s| s.lock().unwrap().generation);
        if current == Some(generation) {
            sessions.remove(&pane_id);
            drop(sessions);
            let _ = app.emit("pty-exit", PtyExit { pane_id, code });
        }
    });

    Ok(())
}

fn with_session<T>(state: &PtyState, pane_id: &str, f: impl FnOnce(&mut Session) -> Result<T, String>) -> Result<T, String> {
    let session = state
        .sessions
        .lock()
        .unwrap()
        .get(pane_id)
        .cloned()
        .ok_or_else(|| format!("no pty for pane {pane_id}"))?;
    let mut s = session.lock().unwrap();
    f(&mut s)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, pane_id: String, data: String) -> Result<(), String> {
    with_session(&state, &pane_id, |s| {
        s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        s.writer.flush().map_err(|e| e.to_string())
    })
}

/// For xterm's `onBinary` (non-UTF-8 mouse reports): each char is one byte.
#[tauri::command]
pub fn pty_write_binary(state: State<'_, PtyState>, pane_id: String, data: Vec<u8>) -> Result<(), String> {
    with_session(&state, &pane_id, |s| {
        s.writer.write_all(&data).map_err(|e| e.to_string())?;
        s.writer.flush().map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, pane_id: String, cols: u16, rows: u16) -> Result<(), String> {
    with_session(&state, &pane_id, |s| {
        s.master
            .resize(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, pane_id: String) -> Result<(), String> {
    let removed = state.sessions.lock().unwrap().remove(&pane_id);
    if let Some(session) = removed {
        let _ = session.lock().unwrap().child.kill();
    }
    Ok(())
}

pub fn kill_all(state: &PtyState) {
    for (_, session) in state.sessions.lock().unwrap().drain() {
        let _ = session.lock().unwrap().child.kill();
    }
}
