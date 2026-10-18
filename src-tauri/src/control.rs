//! Orchestration bridge: lets Claude panes see and drive other panes through the
//! `aurelia_*` tools of `aurelia-space mcp` (orchestrator.rs). That process connects to a
//! Unix socket here, private to the user, with one JSON line per request; the request is
//! handed to the frontend, which owns panes and their screens (src/lib/control.ts), and its
//! answer goes back on the same connection.
//!
//! Visual replies (`aurelia_show_html`) are written under the app folder and served from a
//! loopback-only HTTP server behind a random token, because the browser pane only loads
//! http(s) and the page must not reach the app's own webview.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, LazyLock, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const REPLY_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_HTML: usize = 2 * 1024 * 1024;

static PENDING: LazyLock<Mutex<HashMap<u64, mpsc::Sender<Value>>>> = LazyLock::new(Default::default);
static NEXT: AtomicU64 = AtomicU64::new(1);
/// Port and token of the renders server, once it's up.
static RENDERS: Mutex<Option<(u16, String)>> = Mutex::new(None);

pub fn socket_path() -> PathBuf {
    // Dev builds get their own socket, so a dev instance never answers for the installed app.
    let flavor = if cfg!(debug_assertions) { "-dev" } else { "" };
    let name = format!("control{flavor}.sock");
    let path = crate::config::app_dir().join("run").join(&name);
    if path.as_os_str().len() < 100 {
        path
    } else {
        std::env::temp_dir().join(format!("aurelia-{name}"))
    }
}

fn renders_dir() -> PathBuf {
    crate::config::app_dir().join("renders")
}

fn random_hex(n: usize) -> String {
    let mut bytes = vec![0u8; n];
    if std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes)).is_err() {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        bytes = t.to_le_bytes().iter().cycle().take(n).copied().collect();
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn start(app: AppHandle) {
    let path = socket_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::remove_file(&path);
    let listener = match UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) => return eprintln!("[aurelia] control socket: {e}"),
    };
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    start_renders();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            std::thread::spawn(move || handle(&app, stream));
        }
    });
}

fn handle(app: &AppHandle, stream: UnixStream) {
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let reply = match serde_json::from_str::<Value>(&line) {
        Ok(req) => answer(app, req),
        Err(e) => json!({ "error": format!("bad request: {e}") }),
    };
    let mut stream = stream;
    let _ = writeln!(stream, "{reply}");
}

fn answer(app: &AppHandle, req: Value) -> Value {
    let mut method = req["method"].as_str().unwrap_or("").to_string();
    let mut params = req["params"].clone();
    if method == "show_html" {
        match save_render(&params) {
            Ok(url) => {
                method = "open_url".into();
                params = json!({ "url": url, "title": params["title"] });
            }
            Err(e) => return json!({ "error": e }),
        }
    }
    let id = NEXT.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    PENDING.lock().unwrap().insert(id, tx);
    let sent = app.emit_to("main", "control-request", json!({ "id": id, "method": method, "params": params, "from": req["from"] }));
    let out = match sent {
        Ok(()) => rx.recv_timeout(REPLY_TIMEOUT).unwrap_or_else(|_| json!({ "error": "AureliaSpace didn't answer in time" })),
        Err(e) => json!({ "error": e.to_string() }),
    };
    PENDING.lock().unwrap().remove(&id);
    out
}

/// The frontend's answer to a control request: `{ result }` or `{ error }`.
#[tauri::command]
pub fn control_reply(id: u64, reply: Value) {
    if let Some(tx) = PENDING.lock().unwrap().remove(&id) {
        let _ = tx.send(reply);
    }
}

fn save_render(params: &Value) -> Result<String, String> {
    let html = params["html"].as_str().ok_or("html is required")?;
    if html.len() > MAX_HTML {
        return Err("html is over 2 MB".into());
    }
    let (port, token) = RENDERS.lock().unwrap().clone().ok_or("the renders server isn't running")?;
    let dir = renders_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!("{}.html", random_hex(8));
    std::fs::write(dir.join(&name), html).map_err(|e| e.to_string())?;
    Ok(format!("http://127.0.0.1:{port}/{token}/{name}"))
}

/// Serves `renders/<name>.html` at `/<token>/<name>.html` on loopback; anything else is 404.
fn start_renders() {
    let Ok(listener) = TcpListener::bind("127.0.0.1:0") else { return };
    let Ok(port) = listener.local_addr().map(|a| a.port()) else { return };
    let token = random_hex(16);
    *RENDERS.lock().unwrap() = Some((port, token.clone()));
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut first = String::new();
            if BufReader::new(&stream).read_line(&mut first).is_err() {
                continue;
            }
            let path = first.split_whitespace().nth(1).unwrap_or("");
            let body = path
                .strip_prefix(&format!("/{token}/"))
                .filter(|n| n.len() == 21 && n.ends_with(".html") && n[..16].chars().all(|c| c.is_ascii_hexdigit()))
                .and_then(|n| std::fs::read(renders_dir().join(n)).ok());
            let _ = match body {
                Some(b) => {
                    let head = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
                        b.len()
                    );
                    stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(&b))
                }
                None => stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
            };
        }
    });
}

/// Sends one request to the running app (used by the MCP process). Blocks until it answers.
pub fn request(method: &str, params: Value) -> Result<Value, String> {
    let mut stream = UnixStream::connect(socket_path()).map_err(|_| "AureliaSpace isn't running (no control socket)".to_string())?;
    stream.set_read_timeout(Some(REPLY_TIMEOUT + Duration::from_secs(5))).ok();
    let from = std::env::var("AURELIA_PANE_ID").unwrap_or_default();
    writeln!(stream, "{}", json!({ "method": method, "params": params, "from": from })).map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).map_err(|e| e.to_string())?;
    let reply: Value = serde_json::from_str(&line).map_err(|e| format!("bad reply: {e}"))?;
    match reply.get("error").and_then(|e| e.as_str()) {
        Some(e) => Err(e.to_string()),
        None => Ok(reply["result"].clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpStream;

    fn get(url: &str) -> String {
        let rest = url.strip_prefix("http://").unwrap();
        let (host, path) = rest.split_once('/').unwrap();
        let mut s = TcpStream::connect(host).unwrap();
        write!(s, "GET /{path} HTTP/1.1\r\nHost: {host}\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn renders_are_served_only_behind_the_token() {
        start_renders();
        let url = save_render(&json!({ "html": "<h1>hi</h1>" })).unwrap();
        let ok = get(&url);
        assert!(ok.starts_with("HTTP/1.1 200") && ok.ends_with("<h1>hi</h1>"), "{ok}");
        let name = url.rsplit('/').next().unwrap();
        let port = url.split(':').nth(2).unwrap().split('/').next().unwrap();
        assert!(get(&format!("http://127.0.0.1:{port}/wrongtoken/{name}")).starts_with("HTTP/1.1 404"));
        assert!(get(&url.replace(name, "../config.json")).starts_with("HTTP/1.1 404"));
        let _ = std::fs::remove_file(renders_dir().join(name));
    }
}
