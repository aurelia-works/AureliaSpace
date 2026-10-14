//! The terminal host: a background process (this binary, `pty-host` argument) that owns
//! the panes' PTYs so their shells and agents keep running while the app restarts,
//! updates or crashes. The app talks to it over a Unix socket, one connection per pane:
//!
//! - The first frame is a JSON request. `open` attaches to the pane's live session
//!   (replaying its recent output) or spawns it from the given spec; `list` and
//!   `kill_all` are one-shot.
//! - After `open`, the host streams the pane's output as DATA frames and an EXIT frame
//!   when it ends; the app sends DATA (keystrokes), RESIZE and KILL.
//!
//! A pane has at most one client. While none is attached its output goes only to the
//! ring buffer; while one is, writes to it block, so a frontend that falls behind holds
//! the program back through the PTY exactly as the in-process path does (see pty.rs).
//! Sessions left unattached for ORPHAN_TTL are killed, and the host exits once it has
//! no sessions and no clients.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{self, Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Bumped when the protocol changes; it is part of the socket name, so an old host
/// keeps serving the sessions it has while a new app starts its own.
const PROTOCOL: u32 = 1;
const RING: usize = 2 * 1024 * 1024;
const MAX_FRAME: usize = 16 * 1024 * 1024;
const ORPHAN_TTL: Duration = Duration::from_secs(3 * 24 * 3600);
const IDLE_EXIT: Duration = Duration::from_secs(30);
/// A client that stops reading for this long is dropped (its output keeps going to the ring).
const CLIENT_WRITE_TIMEOUT: Duration = Duration::from_secs(60);

pub const JSON: u8 = 1;
pub const DATA: u8 = 2;
pub const RESIZE: u8 = 3;
pub const KILL: u8 = 4;
pub const EXIT: u8 = 5;

pub fn write_frame(w: &mut impl Write, kind: u8, payload: &[u8]) -> io::Result<()> {
    let mut buf = Vec::with_capacity(5 + payload.len());
    buf.push(kind);
    buf.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    buf.extend_from_slice(payload);
    w.write_all(&buf)?;
    w.flush()
}

pub fn read_frame(r: &mut impl Read) -> io::Result<(u8, Vec<u8>)> {
    let mut head = [0u8; 5];
    r.read_exact(&mut head)?;
    let len = u32::from_be_bytes([head[1], head[2], head[3], head[4]]) as usize;
    if len > MAX_FRAME {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame too large"));
    }
    let mut payload = vec![0u8; len];
    r.read_exact(&mut payload)?;
    Ok((head[0], payload))
}

/// Everything needed to start a pane's shell. The environment is complete (the host's
/// own is not inherited), so the shell sees what the app computed, not what the host
/// happened to start with.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SpawnSpec {
    pub argv: Vec<String>,
    pub cwd: String,
    pub env: Vec<(String, String)>,
}

impl SpawnSpec {
    pub fn command(&self) -> CommandBuilder {
        let mut cmd = CommandBuilder::new(&self.argv[0]);
        cmd.args(&self.argv[1..]);
        cmd.cwd(&self.cwd);
        cmd.env_clear();
        for (k, v) in &self.env {
            cmd.env(k, v);
        }
        cmd
    }
}

pub fn socket_path() -> PathBuf {
    // Dev builds get their own host, so `tauri dev` never attaches to the installed app's panes.
    let flavor = if cfg!(debug_assertions) { "-dev" } else { "" };
    let name = format!("pty-host{flavor}-v{PROTOCOL}.sock");
    let path = crate::config::app_dir().join("run").join(&name);
    // Socket paths are limited to 104 bytes; a long home folder falls back to the
    // per-user temp folder ($TMPDIR is private to the user on macOS).
    if path.as_os_str().len() < 100 {
        path
    } else {
        std::env::temp_dir().join(format!("aurelia-{name}"))
    }
}

// ---------------------------------------------------------------- host side

struct Ring {
    buf: VecDeque<u8>,
    /// Bytes ever dropped from the front; a replay after a wrap starts at the next line.
    wrapped: bool,
}

impl Ring {
    fn push(&mut self, data: &[u8]) {
        self.buf.extend(data);
        if self.buf.len() > RING {
            let drop = self.buf.len() - RING;
            self.buf.drain(..drop);
            self.wrapped = true;
        }
    }

    fn replay(&self) -> Vec<u8> {
        let (a, b) = self.buf.as_slices();
        let mut out = [a, b].concat();
        if self.wrapped {
            // Don't start mid escape sequence or mid line.
            if let Some(nl) = out.iter().position(|&c| c == b'\n') {
                out.drain(..=nl);
            }
        }
        out
    }
}

struct Client {
    id: u64,
    stream: UnixStream,
}

struct Output {
    ring: Ring,
    client: Option<Client>,
    detached_at: Instant,
}

struct HostSession {
    generation: u64,
    pid: Option<u32>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    size: Mutex<(u16, u16)>,
    output: Mutex<Output>,
}

#[derive(Default)]
struct Host {
    sessions: Mutex<HashMap<String, Arc<HostSession>>>,
    next_id: AtomicU64,
    connections: AtomicUsize,
    last_activity: Mutex<Option<Instant>>,
}

impl Host {
    fn touch(&self) {
        *self.last_activity.lock().unwrap() = Some(Instant::now());
    }

    fn spawn(self: &Arc<Self>, pane: &str, spec: &SpawnSpec, cols: u16, rows: u16) -> Result<Arc<HostSession>, String> {
        if spec.argv.is_empty() {
            return Err("empty command".into());
        }
        let size = PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 };
        let pair = native_pty_system().openpty(size).map_err(|e| e.to_string())?;
        let child = pair.slave.spawn_command(spec.command()).map_err(|e| e.to_string())?;
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let session = Arc::new(HostSession {
            generation: self.next_id.fetch_add(1, Ordering::Relaxed),
            pid: child.process_id(),
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            size: Mutex::new((size.cols, size.rows)),
            output: Mutex::new(Output { ring: Ring { buf: VecDeque::new(), wrapped: false }, client: None, detached_at: Instant::now() }),
        });
        self.sessions.lock().unwrap().insert(pane.to_string(), session.clone());

        let host = self.clone();
        let pane = pane.to_string();
        let s = session.clone();
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let mut out = s.output.lock().unwrap();
                        out.ring.push(&buf[..n]);
                        // Blocks while the client is behind: that is the backpressure.
                        let failed = out.client.as_mut().is_some_and(|c| write_frame(&mut c.stream, DATA, &buf[..n]).is_err());
                        if failed {
                            out.client = None;
                            out.detached_at = Instant::now();
                        }
                    }
                    Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
            let code = s.child.lock().unwrap().wait().ok().map(|st| st.exit_code());
            {
                let mut sessions = host.sessions.lock().unwrap();
                if sessions.get(&pane).is_some_and(|cur| cur.generation == s.generation) {
                    sessions.remove(&pane);
                }
            }
            let mut out = s.output.lock().unwrap();
            if let Some(mut c) = out.client.take() {
                let _ = write_frame(&mut c.stream, EXIT, json!({ "code": code }).to_string().as_bytes());
                let _ = c.stream.shutdown(std::net::Shutdown::Both);
            }
            host.touch();
        });
        Ok(session)
    }

    fn kill(&self, pane: &str) {
        let removed = self.sessions.lock().unwrap().remove(pane);
        if let Some(s) = removed {
            let _ = s.child.lock().unwrap().kill();
        }
    }

    fn handle(self: &Arc<Self>, mut stream: UnixStream) -> io::Result<()> {
        let (kind, payload) = read_frame(&mut stream)?;
        if kind != JSON {
            return Ok(());
        }
        let req: Value = serde_json::from_slice(&payload).unwrap_or(Value::Null);
        let reply = |stream: &mut UnixStream, v: Value| write_frame(stream, JSON, v.to_string().as_bytes());
        match req["op"].as_str() {
            Some("list") => {
                let panes: Vec<Value> = self
                    .sessions
                    .lock()
                    .unwrap()
                    .iter()
                    .map(|(id, s)| json!({ "pane": id, "pid": s.pid, "attached": s.output.lock().unwrap().client.is_some() }))
                    .collect();
                reply(&mut stream, json!({ "ok": true, "panes": panes, "pid": std::process::id() }))
            }
            Some("kill_all") => {
                let all: Vec<String> = self.sessions.lock().unwrap().keys().cloned().collect();
                all.iter().for_each(|p| self.kill(p));
                reply(&mut stream, json!({ "ok": true, "killed": all.len() }))
            }
            Some("prune") => {
                // Sessions whose pane is gone from the app's layout.
                let keep: Vec<String> = serde_json::from_value(req["keep"].clone()).unwrap_or_default();
                let gone: Vec<String> = self.sessions.lock().unwrap().keys().filter(|p| !keep.contains(p)).cloned().collect();
                gone.iter().for_each(|p| self.kill(p));
                reply(&mut stream, json!({ "ok": true, "killed": gone.len() }))
            }
            Some("open") => self.open(stream, &req),
            _ => reply(&mut stream, json!({ "ok": false, "error": "unknown op" })),
        }
    }

    fn open(self: &Arc<Self>, mut stream: UnixStream, req: &Value) -> io::Result<()> {
        let pane = req["pane"].as_str().unwrap_or("").to_string();
        let cols = req["cols"].as_u64().unwrap_or(80) as u16;
        let rows = req["rows"].as_u64().unwrap_or(24) as u16;
        if req["fresh"] == true {
            self.kill(&pane);
        }
        let existing = self.sessions.lock().unwrap().get(&pane).cloned();
        let (session, attached) = match existing {
            Some(s) => (s, true),
            None => match serde_json::from_value::<SpawnSpec>(req["spec"].clone()) {
                Ok(spec) => match self.spawn(&pane, &spec, cols, rows) {
                    Ok(s) => (s, false),
                    Err(e) => return write_frame(&mut stream, JSON, json!({ "ok": false, "error": e }).to_string().as_bytes()),
                },
                Err(_) => return write_frame(&mut stream, JSON, json!({ "ok": false, "error": "no session" }).to_string().as_bytes()),
            },
        };

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        stream.set_write_timeout(Some(CLIENT_WRITE_TIMEOUT))?;
        {
            // Under the output lock: the replay and the live stream neither overlap nor leave a gap.
            let mut out = session.output.lock().unwrap();
            let mut s = stream.try_clone()?;
            write_frame(&mut s, JSON, json!({ "ok": true, "attached": attached, "pid": session.pid }).to_string().as_bytes())?;
            if attached {
                write_frame(&mut s, DATA, &out.ring.replay())?;
            }
            if let Some(old) = out.client.replace(Client { id, stream: s }) {
                let _ = old.stream.shutdown(std::net::Shutdown::Both);
            }
        }
        if attached {
            self.redraw(&session, cols, rows);
        }

        // Keystrokes, resizes and kills from the client until it goes away.
        loop {
            let Ok((kind, payload)) = read_frame(&mut stream) else { break };
            match kind {
                DATA => {
                    let mut w = session.writer.lock().unwrap();
                    if w.write_all(&payload).and_then(|_| w.flush()).is_err() {
                        break;
                    }
                }
                RESIZE if payload.len() == 4 => {
                    let cols = u16::from_be_bytes([payload[0], payload[1]]);
                    let rows = u16::from_be_bytes([payload[2], payload[3]]);
                    resize(&session, cols, rows);
                }
                KILL => {
                    if !self.sessions.lock().unwrap().get(&pane).is_some_and(|s| s.generation == session.generation) {
                        break;
                    }
                    // Stay attached: the reader sends EXIT and closes the stream once it's dead.
                    self.kill(&pane);
                }
                _ => {}
            }
        }
        let mut out = session.output.lock().unwrap();
        if out.client.as_ref().is_some_and(|c| c.id == id) {
            out.client = None;
            out.detached_at = Instant::now();
        }
        Ok(())
    }

    /// A reattached app starts from a blank terminal: make the program redraw. The kernel
    /// only signals SIGWINCH on a real change, so a same-size attach nudges the size first.
    fn redraw(&self, session: &Arc<HostSession>, cols: u16, rows: u16) {
        let same = *session.size.lock().unwrap() == (cols.max(1), rows.max(1));
        if same && rows > 2 {
            resize(session, cols, rows - 1);
            let s = session.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(60));
                resize(&s, cols, rows);
            });
        } else {
            resize(session, cols, rows);
        }
    }

    fn reap(&self) {
        let orphans: Vec<String> = self
            .sessions
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, s)| {
                let out = s.output.lock().unwrap();
                out.client.is_none() && out.detached_at.elapsed() > ORPHAN_TTL
            })
            .map(|(p, _)| p.clone())
            .collect();
        orphans.iter().for_each(|p| self.kill(p));
    }
}

fn resize(session: &HostSession, cols: u16, rows: u16) {
    let (cols, rows) = (cols.max(1), rows.max(1));
    let _ = session.master.lock().unwrap().resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
    *session.size.lock().unwrap() = (cols, rows);
}

/// Runs the host on `socket` until it has been idle (no sessions, no clients) for
/// `idle_exit`, or forever with None (tests).
pub fn serve(socket: &Path, idle_exit: Option<Duration>) -> io::Result<()> {
    if socket.exists() {
        if UnixStream::connect(socket).is_ok() {
            return Ok(()); // another host already serves this socket
        }
        let _ = std::fs::remove_file(socket);
    }
    if let Some(dir) = socket.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let listener = UnixListener::bind(socket)?;
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600));
    }
    let host = Arc::new(Host::default());
    host.touch();

    let h = host.clone();
    let path = socket.to_path_buf();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        h.reap();
        let Some(idle) = idle_exit else { continue };
        let quiet = h.sessions.lock().unwrap().is_empty() && h.connections.load(Ordering::SeqCst) == 0;
        let since = h.last_activity.lock().unwrap().map(|t| t.elapsed()).unwrap_or_default();
        if quiet && since > idle {
            // Only remove the socket if it is still ours.
            let _ = std::fs::remove_file(&path);
            std::process::exit(0);
        }
    });

    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let h = host.clone();
        h.connections.fetch_add(1, Ordering::SeqCst);
        h.touch();
        std::thread::spawn(move || {
            let _ = h.handle(stream);
            h.connections.fetch_sub(1, Ordering::SeqCst);
            h.touch();
        });
    }
    Ok(())
}

/// Entry point for `aurelia-space pty-host [socket]`.
pub fn main_entry() {
    let socket = std::env::args().nth(2).map(PathBuf::from).unwrap_or_else(socket_path);
    if let Err(e) = serve(&socket, Some(IDLE_EXIT)) {
        eprintln!("pty-host: {e}");
        std::process::exit(1);
    }
}

// ---------------------------------------------------------------- app side

/// One request/reply on a fresh connection.
fn request(socket: &Path, req: Value) -> Result<(UnixStream, Value), String> {
    let mut stream = UnixStream::connect(socket).map_err(|e| e.to_string())?;
    write_frame(&mut stream, JSON, req.to_string().as_bytes()).map_err(|e| e.to_string())?;
    let (kind, payload) = read_frame(&mut stream).map_err(|e| e.to_string())?;
    if kind != JSON {
        return Err("unexpected reply".into());
    }
    let v: Value = serde_json::from_slice(&payload).map_err(|e| e.to_string())?;
    if v["ok"] != true {
        return Err(v["error"].as_str().unwrap_or("terminal host error").to_string());
    }
    Ok((stream, v))
}

static STARTING: Mutex<()> = Mutex::new(());

/// Connects to the host, starting it (detached, in its own process group) if needed.
pub fn ensure_running(socket: &Path) -> Result<(), String> {
    if UnixStream::connect(socket).is_ok() {
        return Ok(());
    }
    let _guard = STARTING.lock().unwrap();
    if UnixStream::connect(socket).is_ok() {
        return Ok(());
    }
    use std::os::unix::process::CommandExt;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let log = socket.with_extension("log");
    if let Some(dir) = socket.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let stderr = std::fs::OpenOptions::new().create(true).append(true).open(&log).map(std::process::Stdio::from).unwrap_or(std::process::Stdio::null());
    std::process::Command::new(exe)
        .arg("pty-host")
        .arg(socket)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(stderr)
        .process_group(0)
        .spawn()
        .map_err(|e| format!("couldn't start the terminal host: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if UnixStream::connect(socket).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    Err("the terminal host didn't start".into())
}

pub struct Opened {
    pub stream: UnixStream,
    pub attached: bool,
}

pub fn open(socket: &Path, pane: &str, spec: &SpawnSpec, cols: u16, rows: u16, fresh: bool) -> Result<Opened, String> {
    ensure_running(socket)?;
    let (stream, v) = request(socket, json!({ "op": "open", "pane": pane, "spec": spec, "cols": cols, "rows": rows, "fresh": fresh }))?;
    Ok(Opened { stream, attached: v["attached"] == true })
}

/// Panes with a live session, or empty when no host is running (never starts one).
pub fn list(socket: &Path) -> Vec<String> {
    request(socket, json!({ "op": "list" }))
        .map(|(_, v)| v["panes"].as_array().into_iter().flatten().filter_map(|p| p["pane"].as_str().map(String::from)).collect())
        .unwrap_or_default()
}

pub fn kill_all(socket: &Path) -> usize {
    request(socket, json!({ "op": "kill_all" })).map(|(_, v)| v["killed"].as_u64().unwrap_or(0) as usize).unwrap_or(0)
}

pub fn prune(socket: &Path, keep: &[String]) -> usize {
    request(socket, json!({ "op": "prune", "keep": keep })).map(|(_, v)| v["killed"].as_u64().unwrap_or(0) as usize).unwrap_or(0)
}

pub fn send_resize(stream: &mut UnixStream, cols: u16, rows: u16) -> io::Result<()> {
    let mut p = cols.to_be_bytes().to_vec();
    p.extend_from_slice(&rows.to_be_bytes());
    write_frame(stream, RESIZE, &p)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn start_host(name: &str) -> PathBuf {
        let socket = std::env::temp_dir().join(format!("aph-{}-{name}.sock", std::process::id()));
        let _ = std::fs::remove_file(&socket);
        let s = socket.clone();
        std::thread::spawn(move || serve(&s, None).unwrap());
        for _ in 0..100 {
            if UnixStream::connect(&socket).is_ok() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        socket
    }

    fn sh(script: &str) -> SpawnSpec {
        SpawnSpec {
            argv: vec!["/bin/sh".into(), "-c".into(), script.into()],
            cwd: "/tmp".into(),
            env: vec![("PATH".into(), "/usr/bin:/bin".into()), ("AURELIA_TEST".into(), "yes".into())],
        }
    }

    fn open_req(socket: &Path, pane: &str, spec: Option<&SpawnSpec>, fresh: bool) -> Result<Opened, String> {
        let (stream, v) = request(socket, json!({ "op": "open", "pane": pane, "spec": spec, "cols": 80, "rows": 24, "fresh": fresh }))?;
        Ok(Opened { stream, attached: v["attached"] == true })
    }

    /// Reads frames until the collected output contains `want` (or an EXIT, or 5 s pass).
    fn read_until(stream: &mut UnixStream, want: &str) -> (String, Option<Value>) {
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut text = String::new();
        while !text.contains(want) {
            match read_frame(stream) {
                Ok((DATA, b)) => text.push_str(&String::from_utf8_lossy(&b)),
                Ok((EXIT, b)) => return (text, serde_json::from_slice(&b).ok()),
                Ok(_) => {}
                Err(_) => break,
            }
        }
        (text, None)
    }

    #[test]
    fn sessions_outlive_their_client_and_replay_on_reattach() {
        let socket = start_host("reattach");
        let spec = sh("printf 'ready:%s\\n' \"$AURELIA_TEST\"; read x; echo got:$x; sleep 0.4; echo while-away; sleep 30");
        let mut a = open_req(&socket, "p1", Some(&spec), false).unwrap();
        assert!(!a.attached);
        assert!(read_until(&mut a.stream, "ready:yes").0.contains("ready:yes"), "the spec's env reaches the shell");
        write_frame(&mut a.stream, DATA, b"hi\n").unwrap();
        assert!(read_until(&mut a.stream, "got:hi").0.contains("got:hi"));
        drop(a); // the app quits

        std::thread::sleep(Duration::from_millis(700));
        assert_eq!(list(&socket), ["p1"], "still running with nobody attached");
        let mut b = open_req(&socket, "p1", None, false).unwrap();
        assert!(b.attached);
        let (replay, _) = read_until(&mut b.stream, "while-away");
        assert!(replay.contains("ready:yes") && replay.contains("got:hi") && replay.contains("while-away"), "replay: {replay:?}");

        // A second attach takes over; the first client is cut off.
        b.stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let mut c = open_req(&socket, "p1", None, false).unwrap();
        assert!(c.attached);
        let mut cut = false;
        for _ in 0..10 {
            if read_frame(&mut b.stream).is_err() {
                cut = true;
                break;
            }
        }
        assert!(cut, "the replaced client's connection is closed");

        write_frame(&mut c.stream, KILL, &[]).unwrap();
        let mut exited = false;
        c.stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        while let Ok((kind, _)) = read_frame(&mut c.stream) {
            if kind == EXIT {
                exited = true;
                break;
            }
        }
        assert!(exited);
        assert!(list(&socket).is_empty());
    }

    #[test]
    fn reports_the_exit_code_and_forgets_the_session() {
        let socket = start_host("exit");
        let mut a = open_req(&socket, "p", Some(&sh("echo bye; exit 3")), false).unwrap();
        let (text, exit) = read_until(&mut a.stream, "never");
        assert!(text.contains("bye"));
        assert_eq!(exit.unwrap()["code"], 3);
        std::thread::sleep(Duration::from_millis(50));
        assert!(list(&socket).is_empty());
        assert_eq!(open_req(&socket, "p", None, false).err().as_deref(), Some("no session"));
    }

    #[test]
    fn fresh_replaces_a_live_session_and_prune_kills_strays() {
        let socket = start_host("fresh");
        let mut a = open_req(&socket, "p", Some(&sh("echo first; sleep 30")), false).unwrap();
        read_until(&mut a.stream, "first");
        let mut b = open_req(&socket, "p", Some(&sh("echo second; sleep 30")), true).unwrap();
        assert!(!b.attached);
        assert!(read_until(&mut b.stream, "second").0.contains("second"));
        let _c = open_req(&socket, "stray", Some(&sh("sleep 30")), false).unwrap();
        assert_eq!(prune(&socket, &["p".to_string()]), 1);
        assert_eq!(list(&socket), ["p"]);
        assert_eq!(kill_all(&socket), 1);
    }

    #[test]
    fn the_ring_keeps_only_the_tail_from_a_line_start() {
        let mut r = Ring { buf: VecDeque::new(), wrapped: false };
        r.push(b"abc\ndef");
        assert_eq!(r.replay(), b"abc\ndef");
        let line = [b'x'; 1023].iter().chain(b"\n").copied().collect::<Vec<u8>>();
        for _ in 0..(RING / 1024 + 10) {
            r.push(&line);
        }
        let out = r.replay();
        assert!(out.len() <= RING && out.len() > RING - 2048);
        assert_eq!(out[0], b'x', "starts at a line start");
        assert_eq!(out.iter().filter(|&&c| c == b'\n').count() * 1024, out.len());
    }

    #[test]
    fn resize_reaches_the_program() {
        let socket = start_host("resize");
        let mut a = open_req(&socket, "p", Some(&sh("trap 'stty size' WINCH; echo armed; while :; do sleep 0.05; done")), false).unwrap();
        read_until(&mut a.stream, "armed");
        send_resize(&mut a.stream, 100, 40).unwrap();
        assert!(read_until(&mut a.stream, "40 100").0.contains("40 100"));
        kill_all(&socket);
    }
}
