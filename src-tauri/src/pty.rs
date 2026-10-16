//! One PTY per pane. Output is streamed to the frontend as raw bytes over a Tauri
//! channel, coalesced into small batches so busy panes don't flood the IPC bridge.
//! The PTYs live in the terminal host (ptyhost.rs) so panes survive app restarts, or in
//! this process with "keep terminals running" off or when the host can't start.
//!
//! Flow control: xterm parses on the webview's single UI thread, which every pane
//! shares, and one flooding pane can outrun it (measured: a PTY produces ~48 MB/s,
//! headless xterm parses ~69 MB/s before any rendering). The frontend acknowledges
//! bytes once xterm has parsed them (`pty_ack`); while it is more than `FLOW_HIGH`
//! behind, the batcher waits, the bounded reader queue fills, the reader stops reading,
//! and the kernel's PTY buffer makes the program itself wait. Memory stays bounded and
//! keystroke echo never queues behind megabytes of backlog.

use crate::config;
use crate::integration;
use crate::ptyhost::{self, SpawnSpec};
use portable_pty::{native_pty_system, Child, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State};

const READ_BUF: usize = 64 * 1024;
const BATCH_WINDOW: Duration = Duration::from_millis(3);
const BATCH_MAX: usize = 512 * 1024;
/// Reader chunks buffered between the reader and the batcher (each up to READ_BUF).
const READ_QUEUE: usize = 16;
/// Pause sending once the frontend is this many bytes behind...
const FLOW_HIGH: usize = 2 * 1024 * 1024;
/// ...and resume once it has caught up to this.
const FLOW_LOW: usize = 512 * 1024;
/// A webview that stops acknowledging (reloaded, crashed) must not freeze the pane forever.
const FLOW_STALL: Duration = Duration::from_secs(10);

/// Bytes sent to the frontend that xterm has not parsed yet.
#[derive(Default)]
pub struct Flow {
    pending: Mutex<usize>,
    caught_up: Condvar,
}

impl Flow {
    fn sent(&self, n: usize) {
        *self.pending.lock().unwrap() += n;
    }

    fn ack(&self, n: usize) {
        let mut p = self.pending.lock().unwrap();
        *p = p.saturating_sub(n);
        if *p <= FLOW_LOW {
            self.caught_up.notify_all();
        }
    }

    /// Blocks while the frontend is more than FLOW_HIGH behind, until it is back under
    /// FLOW_LOW. After `stall` with no progress the debt is forgotten and sending resumes.
    /// Returns whether it had to wait.
    fn wait(&self, stall: Duration) -> bool {
        let mut p = self.pending.lock().unwrap();
        if *p <= FLOW_HIGH {
            return false;
        }
        let mut deadline = Instant::now() + stall;
        let mut last = *p;
        while *p > FLOW_LOW {
            let now = Instant::now();
            if now >= deadline {
                *p = 0;
                break;
            }
            p = self.caught_up.wait_timeout(p, deadline - now).unwrap().0;
            if *p < last {
                // Still making progress: a slow frontend is not a dead one.
                last = *p;
                deadline = Instant::now() + stall;
            }
        }
        true
    }
}

/// Where a pane's shell runs: in this process (it dies with the app) or in the terminal
/// host (ptyhost.rs), reached over the pane's own socket connection.
enum Io {
    Local {
        writer: Box<dyn Write + Send>,
        master: Box<dyn MasterPty + Send>,
        child: Box<dyn Child + Send + Sync>,
    },
    Host {
        conn: UnixStream,
    },
}

struct Session {
    io: Io,
    /// Bumped on respawn so a stale reader thread doesn't report the new session's exit.
    generation: u64,
    flow: Arc<Flow>,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Spawned {
    /// Reattached to a shell that kept running in the terminal host (it got its recent
    /// output replayed and was asked to redraw): don't type a startup command into it.
    attached: bool,
}

fn default_shell(cfg: &config::Config) -> String {
    if !cfg.terminal.shell.is_empty() {
        return config::expand_path(&cfg.terminal.shell);
    }
    std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into())
}

fn build_spec(
    cfg: &config::Config,
    pane_id: &str,
    cwd: Option<String>,
    account: Option<String>,
    env: Option<HashMap<String, String>>,
    secret_env: Option<HashMap<String, String>>,
) -> Result<SpawnSpec, String> {
    let shell = default_shell(cfg);
    let dir = cwd
        .or_else(|| Some(cfg.default_workspace.clone()).filter(|w| !w.is_empty()))
        .map(|c| config::expand_path(&c))
        .filter(|c| Path::new(c).is_dir())
        .unwrap_or_else(|| config::home_dir().to_string_lossy().into_owned());

    let mut vars: BTreeMap<String, String> = std::env::vars().collect();
    // Don't leak the environment of whatever launched the app (e.g. a Claude Code
    // session during development) into the panes.
    for var in ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CONFIG_DIR", "TERM_PROGRAM_VERSION"] {
        vars.remove(var);
    }
    let mut set = |k: &str, v: &str| {
        vars.insert(k.to_string(), v.to_string());
    };
    set("TERM", "xterm-256color");
    set("COLORTERM", "truecolor");
    set("TERM_PROGRAM", "AureliaSpace");
    if std::env::var("LANG").map(|v| v.is_empty()).unwrap_or(true) {
        set("LANG", "en_US.UTF-8");
    }

    let paths = integration::paths();
    let s = |p: &Path| p.to_string_lossy().into_owned();
    set("AURELIA_PANE_ID", pane_id);
    set("AURELIA_EVENTS_FILE", &s(&paths.events_file));
    set("AURELIA_CLAUDE_SETTINGS", &s(&paths.claude_settings));
    set("AURELIA_CLAUDE_MCP", &s(&paths.claude_mcp));

    // Shell integration via ZDOTDIR (zsh only; other shells run without blocks).
    if Path::new(&shell).file_name().is_some_and(|n| n == "zsh") {
        if let Ok(orig) = std::env::var("ZDOTDIR") {
            set("AURELIA_ORIG_ZDOTDIR", &orig);
        }
        set("ZDOTDIR", &s(&paths.zdotdir));
        set("AURELIA_ZSH_INTEGRATION", &s(&paths.zsh_integration));
    }

    if let Some(name) = account {
        let acct = cfg
            .accounts
            .iter()
            .find(|a| a.name == name)
            .ok_or_else(|| format!("unknown account '{name}'"))?;
        if !acct.is_default() {
            set("CLAUDE_CONFIG_DIR", &acct.resolved_dir());
        }
        set("AURELIA_ACCOUNT", &acct.name);
    }
    // Agent CLI settings (e.g. an API key from the Keychain) go in last so they win.
    for (k, v) in crate::agents::resolve_env(env, secret_env)? {
        set(&k, &v);
    }
    Ok(SpawnSpec { argv: vec![shell, "-l".into()], cwd: dir, env: vars.into_iter().collect() })
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
    fresh: Option<bool>,
    on_data: Channel<InvokeResponseBody>,
) -> Result<Spawned, String> {
    let fresh = fresh.unwrap_or(false);
    // A webview reload opens existing panes again: let go of (local: kill) the old session.
    if let Some(old) = state.sessions.lock().unwrap().remove(&pane_id) {
        if let Io::Local { child, .. } = &mut old.lock().unwrap().io {
            let _ = child.kill();
        }
    }

    let cfg = config::load();
    let spec = build_spec(&cfg, &pane_id, cwd, account, env, secret_env)?;
    // Bounded: when the batcher waits on the frontend, the reader blocks here and stops reading.
    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(READ_QUEUE);
    let exit_code: Arc<Mutex<Option<u32>>> = Default::default();

    let hosted = cfg.terminal.keep_alive.then(|| ptyhost::open(&ptyhost::socket_path(), &pane_id, &spec, cols, rows, fresh));
    let (io, attached) = match hosted {
        Some(Ok(opened)) => {
            let mut conn = opened.stream.try_clone().map_err(|e| e.to_string())?;
            let code = exit_code.clone();
            std::thread::spawn(move || loop {
                match ptyhost::read_frame(&mut conn) {
                    Ok((ptyhost::DATA, bytes)) => {
                        if tx.send(bytes).is_err() {
                            break;
                        }
                    }
                    Ok((ptyhost::EXIT, payload)) => {
                        let v: serde_json::Value = serde_json::from_slice(&payload).unwrap_or_default();
                        *code.lock().unwrap() = v["code"].as_u64().map(|c| c as u32);
                        break;
                    }
                    Ok(_) => {}
                    Err(_) => break,
                }
            });
            (Io::Host { conn: opened.stream }, opened.attached)
        }
        other => {
            if let Some(Err(e)) = other {
                // Still usable, just not across restarts.
                eprintln!("terminal host unavailable ({e}); running {pane_id} in-process");
            }
            (spawn_local(&spec, cols, rows, tx)?, false)
        }
    };

    let generation = {
        let mut g = state.generation.lock().unwrap();
        *g += 1;
        *g
    };
    let flow = Arc::new(Flow::default());
    let session = Arc::new(Mutex::new(Session { io, generation, flow: flow.clone() }));
    state.sessions.lock().unwrap().insert(pane_id.clone(), session.clone());

    std::thread::spawn(move || {
        forward(&rx, Some(&flow), FLOW_STALL, |out| {
            crate::remote::tap(&pane_id, &out);
            on_data.send(InvokeResponseBody::Raw(out)).is_ok()
        });

        let code = {
            let mut s = session.lock().unwrap();
            match &mut s.io {
                Io::Local { child, .. } => child.wait().ok().map(|st| st.exit_code()),
                Io::Host { .. } => *exit_code.lock().unwrap(),
            }
        };
        let state = app.state::<PtyState>();
        let mut sessions = state.sessions.lock().unwrap();
        let current = sessions.get(&pane_id).map(|s| s.lock().unwrap().generation);
        if current == Some(generation) {
            sessions.remove(&pane_id);
            drop(sessions);
            crate::remote::exit(&pane_id);
            let _ = app.emit("pty-exit", PtyExit { pane_id, code });
        }
    });

    Ok(Spawned { attached })
}

/// The in-process path: the shell is this app's child and dies with it.
fn spawn_local(spec: &SpawnSpec, cols: u16, rows: u16, tx: mpsc::SyncSender<Vec<u8>>) -> Result<Io, String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let child = pair.slave.spawn_command(spec.command()).map_err(|e| e.to_string())?;
    drop(pair.slave); // so the reader sees EOF when the shell exits
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
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
    Ok(Io::Local { writer, master: pair.master, child })
}

/// Batches reader chunks (up to BATCH_WINDOW / BATCH_MAX) and hands them to `send`,
/// waiting on `flow` first. Returns when the reader is done or `send` fails.
fn forward(rx: &mpsc::Receiver<Vec<u8>>, flow: Option<&Flow>, stall: Duration, mut send: impl FnMut(Vec<u8>) -> bool) {
    while let Ok(first) = rx.recv() {
        let mut out = first;
        let deadline = Instant::now() + BATCH_WINDOW;
        let mut done = false;
        while out.len() < BATCH_MAX {
            match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                Ok(chunk) => out.extend_from_slice(&chunk),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => {
                    done = true;
                    break;
                }
            }
        }
        if let Some(f) = flow {
            f.wait(stall);
        }
        let n = out.len();
        if !send(out) || done {
            return;
        }
        if let Some(f) = flow {
            f.sent(n);
        }
    }
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

fn write_input(s: &mut Session, data: &[u8]) -> Result<(), String> {
    match &mut s.io {
        Io::Local { writer, .. } => writer.write_all(data).and_then(|_| writer.flush()).map_err(|e| e.to_string()),
        Io::Host { conn } => ptyhost::write_frame(conn, ptyhost::DATA, data).map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, pane_id: String, data: String) -> Result<(), String> {
    with_session(&state, &pane_id, |s| write_input(s, data.as_bytes()))
}

/// For xterm's `onBinary` (non-UTF-8 mouse reports): each char is one byte.
#[tauri::command]
pub fn pty_write_binary(state: State<'_, PtyState>, pane_id: String, data: Vec<u8>) -> Result<(), String> {
    with_session(&state, &pane_id, |s| write_input(s, &data))
}

/// xterm has parsed `bytes` more of this pane's output (see the flow control note above).
#[tauri::command]
pub fn pty_ack(state: State<'_, PtyState>, pane_id: String, bytes: usize) -> Result<(), String> {
    let flow = with_session(&state, &pane_id, |s| Ok(s.flow.clone()))?;
    flow.ack(bytes);
    Ok(())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, pane_id: String, cols: u16, rows: u16) -> Result<(), String> {
    // A phone that fits this pane holds its size; the remote applies this once it lets go.
    if !crate::remote::desk_resize(&pane_id, cols, rows) {
        return Ok(());
    }
    resize_to(&state, &pane_id, cols, rows)
}

/// Types into a pane for the phone remote (remote.rs).
pub fn write_to(state: &PtyState, pane_id: &str, data: &[u8]) -> Result<(), String> {
    with_session(state, pane_id, |s| write_input(s, data))
}

pub fn resize_to(state: &PtyState, pane_id: &str, cols: u16, rows: u16) -> Result<(), String> {
    with_session(state, pane_id, |s| match &mut s.io {
        Io::Local { master, .. } => master
            .resize(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string()),
        Io::Host { conn } => ptyhost::send_resize(conn, cols, rows).map_err(|e| e.to_string()),
    })
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, pane_id: String) -> Result<(), String> {
    let removed = state.sessions.lock().unwrap().remove(&pane_id);
    crate::remote::exit(&pane_id);
    if let Some(session) = removed {
        match &mut session.lock().unwrap().io {
            Io::Local { child, .. } => {
                let _ = child.kill();
            }
            Io::Host { conn } => {
                let _ = ptyhost::write_frame(conn, ptyhost::KILL, &[]);
            }
        }
    }
    Ok(())
}

/// Panes whose shell is still running in the terminal host (e.g. from before a restart).
/// Never starts the host.
#[tauri::command]
pub async fn pty_alive() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(|| ptyhost::list(&ptyhost::socket_path())).await.unwrap_or_default()
}

/// Ends host sessions whose pane is no longer in the layout (closed while the app was
/// down, or a lost layout). Returns how many it ended.
#[tauri::command]
pub async fn pty_prune(keep: Vec<String>) -> usize {
    tauri::async_runtime::spawn_blocking(move || ptyhost::prune(&ptyhost::socket_path(), &keep)).await.unwrap_or(0)
}

/// Settings' "stop background terminals": ends every session in the terminal host.
#[tauri::command]
pub async fn pty_stop_background() -> usize {
    tauri::async_runtime::spawn_blocking(|| ptyhost::kill_all(&ptyhost::socket_path())).await.unwrap_or(0)
}

/// On quit: in-process shells die with the app; hosted ones keep running for next launch.
pub fn kill_all(state: &PtyState) {
    for (_, session) in state.sessions.lock().unwrap().drain() {
        if let Io::Local { child, .. } = &mut session.lock().unwrap().io {
            let _ = child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use portable_pty::CommandBuilder;

    #[test]
    fn the_spawn_spec_carries_the_whole_environment() {
        let mut cfg = config::Config::default();
        cfg.terminal.shell = "/bin/zsh".into();
        let mut env = HashMap::new();
        env.insert("OPENAI_BASE_URL".to_string(), "http://x".to_string());
        let spec = build_spec(&cfg, "pane-1", Some("/tmp".into()), None, Some(env), None).unwrap();
        let get = |k: &str| spec.env.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
        assert_eq!(spec.argv, ["/bin/zsh", "-l"]);
        assert!(spec.cwd == "/tmp" || spec.cwd == "/private/tmp");
        assert_eq!(get("AURELIA_PANE_ID"), Some("pane-1"));
        assert_eq!(get("TERM"), Some("xterm-256color"));
        assert_eq!(get("OPENAI_BASE_URL"), Some("http://x"));
        assert!(get("ZDOTDIR").is_some_and(|z| z.ends_with("shell/zsh")));
        assert_eq!(get("CLAUDECODE"), None, "the launching session's env never reaches a pane");
        assert!(get("PATH").is_some(), "inherits the app's environment otherwise");
    }


    #[test]
    fn flow_does_not_wait_under_the_high_mark() {
        let f = Flow::default();
        f.sent(FLOW_HIGH);
        assert!(!f.wait(Duration::from_millis(50)));
    }

    #[test]
    fn flow_waits_until_acknowledged_below_the_low_mark() {
        let f = Arc::new(Flow::default());
        f.sent(FLOW_HIGH + 1);
        let acker = {
            let f = f.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(80));
                f.ack(FLOW_HIGH); // leaves 1 byte pending, under FLOW_LOW
            })
        };
        let t = Instant::now();
        assert!(f.wait(Duration::from_secs(5)));
        let waited = t.elapsed();
        acker.join().unwrap();
        assert!(waited >= Duration::from_millis(70), "returned before the ack: {waited:?}");
        assert!(waited < Duration::from_secs(2), "kept waiting after the ack: {waited:?}");
        assert_eq!(*f.pending.lock().unwrap(), 1);
    }

    #[test]
    fn flow_gives_up_on_a_frontend_that_never_acknowledges() {
        let f = Flow::default();
        f.sent(FLOW_HIGH * 2);
        let t = Instant::now();
        assert!(f.wait(Duration::from_millis(100)));
        assert!(t.elapsed() < Duration::from_secs(2));
        assert_eq!(*f.pending.lock().unwrap(), 0);
    }

    #[test]
    fn flow_keeps_waiting_while_a_slow_frontend_makes_progress() {
        let f = Arc::new(Flow::default());
        f.sent(FLOW_HIGH * 2);
        let acker = {
            let f = f.clone();
            std::thread::spawn(move || {
                // Ten small acks 40 ms apart: 400 ms in all, longer than the 150 ms stall.
                for _ in 0..10 {
                    std::thread::sleep(Duration::from_millis(40));
                    f.ack(FLOW_HIGH * 2 / 10);
                }
            })
        };
        let t = Instant::now();
        assert!(f.wait(Duration::from_millis(150)));
        let waited = t.elapsed();
        acker.join().unwrap();
        // Under FLOW_LOW only after the 9th ack (~360 ms); giving up would return at ~150 ms.
        assert!(waited >= Duration::from_millis(300), "gave up on a frontend that was still acking: {waited:?}");
    }

    /// A real PTY flooding output (`yes`) into a frontend that never acknowledges, for up
    /// to `deadline` or until `enough` bytes got through. With flow control only about
    /// FLOW_HIGH reaches the frontend and the program is held back; without it,
    /// everything the program writes is pushed through.
    fn flood(flow: Option<&Flow>, deadline: Duration, enough: usize) -> usize {
        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        let mut cmd = CommandBuilder::new("/usr/bin/yes");
        cmd.arg("building module foo/bar/baz.rs ... ok");
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(READ_QUEUE);
        std::thread::spawn(move || {
            let mut buf = vec![0u8; READ_BUF];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });
        let start = Instant::now();
        let mut total = 0usize;
        forward(&rx, flow, Duration::from_secs(2), |out| {
            if start.elapsed() >= deadline || total >= enough {
                return false;
            }
            total += out.len();
            true
        });
        let _ = child.kill();
        total
    }

    #[test]
    fn flood_is_held_back_until_the_frontend_catches_up() {
        // A batch can pass BATCH_MAX by one reader chunk before it is sent.
        let bound = FLOW_HIGH + BATCH_MAX + READ_BUF;
        // Conditions, not timing: a busy machine slows both floods but can't make the gated
        // one exceed its bound, and the ungated one gets as long as it needs to run past it.
        let gated = flood(Some(&Flow::default()), Duration::from_millis(1500), usize::MAX);
        let unbounded = flood(None, Duration::from_secs(30), bound * 4);
        println!("bytes pushed to a frontend that never acks: without flow control {unbounded}, with {gated}");
        assert!(gated <= bound, "flow control let {gated} bytes through");
        assert!(unbounded >= bound * 4, "expected the ungated flood to run far ahead ({unbounded} vs {gated})");
    }
}
