//! The phone remote: a small web server in the app that lists the panes and drives them
//! from a phone browser (the `remote.html` entry, src/remote/). Off by default.
//!
//! - Output: pty.rs hands every batch it sends to the webview to `tap`, which keeps a
//!   ring per pane (replayed when a phone opens it) and fans it out to the phones
//!   watching. A phone that falls behind is dropped; it reconnects and replays.
//! - Input: phones type into the pane through the same path as the desktop's keystrokes.
//! - Size: a phone can "fit" a pane, resizing its PTY to the phone's width so a TUI like
//!   Claude Code redraws for it. While any phone fits a pane the desktop's resizes are
//!   only recorded; the last one is applied once the phones let go.
//! - Pane list: the frontend owns titles and agent state, and pushes a snapshot
//!   (`remote_snapshot`) that is relayed to every phone as is.
//!
//! Access: requests are accepted only from this Mac, Tailscale (100.64.0.0/10) and, with
//! `allow_lan`, private LAN addresses, and must carry the pairing cookie, which a phone
//! gets by opening the QR code's `/pair?k=<token>` link once.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Query, State};
use axum::http::{header, HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, watch};

const RING: usize = 1024 * 1024;
/// Output batches queued for one phone before it counts as fallen behind.
const CLIENT_QUEUE: usize = 1024;
const COOKIE: &str = "aurelia_remote";
const PING: Duration = Duration::from_secs(20);

/// What the server needs from the app; the app's version is `AppHost`, tests use a fake.
pub trait Host: Send + Sync + 'static {
    fn write(&self, pane: &str, data: &[u8]) -> Result<(), String>;
    fn resize(&self, pane: &str, cols: u16, rows: u16) -> Result<(), String>;
    /// Something only the frontend can do (open or close a pane), relayed as is.
    fn action(&self, action: Value);
    fn asset(&self, path: &str) -> Option<(Vec<u8>, String)>;
    fn clients(&self, n: usize);
}

enum Out {
    Data(Vec<u8>),
    /// The PTY's size changed. Every phone shows exactly this size: drawing a program's
    /// output at any other width garbles it, whoever set the size.
    Size(u16, u16),
    Exit,
}

struct Sub {
    id: u64,
    tx: mpsc::Sender<Out>,
    fit: Option<(u16, u16)>,
}

#[derive(Default)]
struct Mirror {
    ring: VecDeque<u8>,
    wrapped: bool,
    subs: Vec<Sub>,
    /// The size the desktop last asked for, and the size the PTY has now.
    desk: Option<(u16, u16)>,
    applied: Option<(u16, u16)>,
}

impl Mirror {
    fn replay(&self) -> Vec<u8> {
        let (a, b) = self.ring.as_slices();
        let mut out = [a, b].concat();
        if self.wrapped {
            if let Some(nl) = out.iter().position(|&c| c == b'\n') {
                out.drain(..=nl);
            }
        }
        out
    }

    /// The newest phone that fits wins; with none, the desktop's size.
    fn target(&self) -> Option<(u16, u16)> {
        self.subs.iter().rev().find_map(|s| s.fit).or(self.desk)
    }
}

struct Running {
    port: u16,
    stop: watch::Sender<bool>,
}

struct Remote {
    mirrors: Mutex<HashMap<String, Mirror>>,
    snapshot: watch::Sender<Value>,
    host: Mutex<Option<Arc<dyn Host>>>,
    server: Mutex<Option<Running>>,
    error: Mutex<Option<String>>,
    next_id: AtomicU64,
    clients: AtomicUsize,
}

static REMOTE: LazyLock<Remote> = LazyLock::new(|| Remote {
    mirrors: Default::default(),
    snapshot: watch::channel(json!({ "panes": [] })).0,
    host: Default::default(),
    server: Default::default(),
    error: Default::default(),
    next_id: AtomicU64::new(1),
    clients: AtomicUsize::new(0),
});

fn host() -> Option<Arc<dyn Host>> {
    REMOTE.host.lock().unwrap().clone()
}

// ---------------------------------------------------------------- called by pty.rs

/// A batch of a pane's output on its way to the webview.
pub fn tap(pane: &str, data: &[u8]) {
    let mut mirrors = REMOTE.mirrors.lock().unwrap();
    let m = mirrors.entry(pane.to_string()).or_default();
    m.ring.extend(data);
    if m.ring.len() > RING {
        let drop = m.ring.len() - RING;
        m.ring.drain(..drop);
        m.wrapped = true;
    }
    // A full queue means the phone fell behind: drop it (it reconnects and replays).
    m.subs.retain(|s| s.tx.try_send(Out::Data(data.to_vec())).is_ok());
}

/// The pane's shell ended or the pane was closed.
pub fn exit(pane: &str) {
    if let Some(m) = REMOTE.mirrors.lock().unwrap().remove(pane) {
        for s in m.subs {
            let _ = s.tx.try_send(Out::Exit);
        }
    }
}

/// The desktop resized the pane. Returns whether to apply it now: not while a phone fits it.
pub fn desk_resize(pane: &str, cols: u16, rows: u16) -> bool {
    let mut mirrors = REMOTE.mirrors.lock().unwrap();
    let m = mirrors.entry(pane.to_string()).or_default();
    m.desk = Some((cols, rows));
    if m.subs.iter().any(|s| s.fit.is_some()) {
        return false;
    }
    if m.applied != Some((cols, rows)) {
        m.applied = Some((cols, rows));
        for s in &m.subs {
            let _ = s.tx.try_send(Out::Size(cols, rows));
        }
    }
    true
}

/// The desktop opened the pane at this size. Until now the remote only learnt the
/// desktop's size from resizes, so a pane never resized since launch had nothing to go
/// back to when the last phone let go, and kept the phone's size.
pub fn spawned(pane: &str, cols: u16, rows: u16) {
    {
        let mut mirrors = REMOTE.mirrors.lock().unwrap();
        let m = mirrors.entry(pane.to_string()).or_default();
        m.desk = Some((cols, rows));
        m.applied = Some((cols, rows));
    }
    // A phone still fitting it (a webview reload respawns panes) gets its size back.
    settle(pane, false);
}

/// The frontend's pane list (titles, agent state, accounts, projects), relayed to phones.
pub fn set_snapshot(v: Value) {
    REMOTE.snapshot.send_replace(v);
}

// ---------------------------------------------------------------- pane subscriptions

fn subscribe(pane: &str, fit: Option<(u16, u16)>) -> (u64, mpsc::Receiver<Out>, Option<(u16, u16)>) {
    let id = REMOTE.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel(CLIENT_QUEUE);
    {
        // Under the lock: the replay and the live stream neither overlap nor leave a gap.
        let mut mirrors = REMOTE.mirrors.lock().unwrap();
        let m = mirrors.entry(pane.to_string()).or_default();
        let _ = tx.try_send(Out::Data(m.replay()));
        m.subs.push(Sub { id, tx, fit });
    }
    settle(pane, true);
    let size = REMOTE.mirrors.lock().unwrap().get(pane).and_then(|m| m.applied);
    (id, rx, size)
}

/// The phone being typed into takes the size back if another device took it since.
fn claim(pane: &str, id: u64) {
    {
        let mut mirrors = REMOTE.mirrors.lock().unwrap();
        let Some(m) = mirrors.get_mut(pane) else { return };
        let Some(i) = m.subs.iter().position(|s| s.id == id && s.fit.is_some()) else { return };
        if i + 1 == m.subs.len() {
            return;
        }
        let sub = m.subs.remove(i);
        m.subs.push(sub);
    }
    settle(pane, false);
}

fn set_fit(pane: &str, id: u64, fit: Option<(u16, u16)>) {
    if let Some(s) = REMOTE.mirrors.lock().unwrap().get_mut(pane).and_then(|m| m.subs.iter_mut().find(|s| s.id == id)) {
        s.fit = fit;
    }
    settle(pane, false);
}

fn unsubscribe(pane: &str, id: u64) {
    if let Some(m) = REMOTE.mirrors.lock().unwrap().get_mut(pane) {
        m.subs.retain(|s| s.id != id);
    }
    settle(pane, false);
}

/// Gives the PTY the size it should have now, and tells the phones. `redraw` also makes
/// the program repaint, for a phone that just opened the pane and has only the raw
/// replay (diffs drawn for whatever was on screen before). Only a width change makes a
/// TUI like Claude Code repaint everything, so an unchanged width is nudged by a column.
fn settle(pane: &str, redraw: bool) {
    let (target, before) = {
        let mut mirrors = REMOTE.mirrors.lock().unwrap();
        let Some(m) = mirrors.get_mut(pane) else { return };
        let target = m.target();
        let before = m.applied;
        if let Some((cols, rows)) = target.filter(|t| Some(*t) != before) {
            m.applied = target;
            for s in &m.subs {
                let _ = s.tx.try_send(Out::Size(cols, rows));
            }
        }
        (target, before)
    };
    let (Some((cols, rows)), Some(h)) = (target, host()) else { return };
    if Some((cols, rows)) != before {
        let _ = h.resize(pane, cols, rows);
    }
    let width_changed = before.map(|(c, _)| c) != Some(cols);
    if redraw && !width_changed && cols > 20 {
        let _ = h.resize(pane, cols - 1, rows);
        let pane = pane.to_string();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(80));
            let _ = h.resize(&pane, cols, rows);
        });
    }
}

// ---------------------------------------------------------------- server

struct Ctx {
    host: Arc<dyn Host>,
    token: String,
    allow_lan: bool,
    stop: watch::Receiver<bool>,
}

type Shared = Arc<Ctx>;

fn allowed(ip: IpAddr, lan: bool) -> bool {
    let ip = match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(IpAddr::V6(v6)),
        v4 => v4,
    };
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            let tailscale = a == 100 && (64..128).contains(&b);
            v4.is_loopback() || tailscale || (lan && (v4.is_private() || v4.is_link_local()))
        }
        IpAddr::V6(v6) => {
            let s = v6.segments();
            let tailscale = s[0] == 0xfd7a && s[1] == 0x115c && s[2] == 0xa1e0;
            v6.is_loopback() || tailscale || (lan && ((s[0] & 0xfe00) == 0xfc00 || (s[0] & 0xffc0) == 0xfe80))
        }
    }
}

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn paired(ctx: &Ctx, headers: &HeaderMap) -> bool {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|kv| kv.trim().strip_prefix(COOKIE)?.strip_prefix('='))
        .any(|v| same(v, &ctx.token))
}

fn page(status: StatusCode, title: &str, body: &str) -> Response {
    let html = format!(
        "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>{title}</title>\
<style>body{{background:#08090c;color:#ece8e1;font:16px -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;padding:0 24px;text-align:center}}h1{{font-size:20px}}p{{color:#a7aab2;line-height:1.5}}</style>\
<div><h1>{title}</h1><p>{body}</p></div>"
    );
    (status, [(header::CONTENT_TYPE, "text/html; charset=utf-8"), (header::CACHE_CONTROL, "no-store")], html).into_response()
}

fn forbidden() -> Response {
    page(StatusCode::FORBIDDEN, "Not allowed", "This address can't reach AureliaSpace. Connect through Tailscale, or allow the local network in Settings → Remote.")
}

fn unpaired() -> Response {
    page(StatusCode::UNAUTHORIZED, "Pair this phone", "On your Mac, open AureliaSpace → Settings → Remote and scan the QR code with this phone's camera.")
}

async fn pair(State(ctx): State<Shared>, ConnectInfo(addr): ConnectInfo<SocketAddr>, Query(q): Query<HashMap<String, String>>) -> Response {
    if !allowed(addr.ip(), ctx.allow_lan) {
        return forbidden();
    }
    if !q.get("k").is_some_and(|k| same(k, &ctx.token)) {
        return page(StatusCode::FORBIDDEN, "Link expired", "This pairing link is no longer valid. Scan the current QR code in Settings → Remote.");
    }
    let cookie = format!("{COOKIE}={}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict", ctx.token);
    (StatusCode::FOUND, [(header::SET_COOKIE, cookie), (header::LOCATION, "/".to_string())]).into_response()
}

async fn ws(State(ctx): State<Shared>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, upgrade: WebSocketUpgrade) -> Response {
    if !allowed(addr.ip(), ctx.allow_lan) {
        return forbidden();
    }
    // Another site open on the phone must not ride the cookie into a socket.
    let host = headers.get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()).unwrap_or("");
    let origin_host = origin.split_once("://").map(|(_, h)| h).unwrap_or("");
    if !paired(&ctx, &headers) || origin_host != host {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    upgrade.on_upgrade(move |socket| session(ctx, socket))
}

const MANIFEST: &str = r##"{"name":"AureliaSpace","short_name":"Aurelia","start_url":"/","display":"standalone","background_color":"#08090c","theme_color":"#08090c","icons":[{"src":"/icon.png","sizes":"256x256","type":"image/png"}]}"##;

async fn files(State(ctx): State<Shared>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, uri: Uri) -> Response {
    if !allowed(addr.ip(), ctx.allow_lan) {
        return forbidden();
    }
    let path = uri.path();
    // The home-screen icon and manifest are fetched without cookies on iOS.
    match path {
        "/icon.png" => return ([(header::CONTENT_TYPE, "image/png")], include_bytes!("../icons/128x128@2x.png").as_slice()).into_response(),
        "/remote.webmanifest" => return ([(header::CONTENT_TYPE, "application/manifest+json")], MANIFEST).into_response(),
        _ => {}
    }
    if !paired(&ctx, &headers) {
        return unpaired();
    }
    let file = if path == "/" { "remote.html" } else { path.trim_start_matches('/') };
    // Only the remote page and the bundles it loads, not the desktop app's pages.
    if file.ends_with(".html") && file != "remote.html" {
        return StatusCode::NOT_FOUND.into_response();
    }
    match ctx.host.asset(file) {
        Some((bytes, mime)) => {
            let cache = if file.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
            ([(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, cache.to_string())], bytes).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

fn size_of(v: &Value) -> Option<(u16, u16)> {
    let c = v["cols"].as_u64()?;
    let r = v["rows"].as_u64()?;
    Some((c.clamp(20, 500) as u16, r.clamp(5, 300) as u16))
}

/// One phone: the pane list, and at most one open pane at a time.
async fn session(ctx: Shared, socket: WebSocket) {
    let n = REMOTE.clients.fetch_add(1, Ordering::SeqCst) + 1;
    ctx.host.clients(n);
    let (mut sink, mut incoming) = socket.split();
    let mut snapshot = REMOTE.snapshot.subscribe();
    let mut stop = ctx.stop.clone();
    let mut open: Option<(String, u64, mpsc::Receiver<Out>)> = None;
    let mut ping = tokio::time::interval(PING);

    let first = json!({ "t": "snap", "snap": *snapshot.borrow_and_update() }).to_string();
    if sink.send(Message::Text(first.into())).await.is_ok() {
        loop {
            let out = async {
                match open.as_mut() {
                    Some((_, _, rx)) => rx.recv().await,
                    None => std::future::pending().await,
                }
            };
            let msg: Option<Message> = tokio::select! {
                _ = stop.changed() => break,
                _ = ping.tick() => Some(Message::Ping(Vec::new().into())),
                changed = snapshot.changed() => {
                    if changed.is_err() { break }
                    Some(Message::Text(json!({ "t": "snap", "snap": *snapshot.borrow_and_update() }).to_string().into()))
                }
                out = out => match out {
                    Some(Out::Data(bytes)) => Some(Message::Binary(bytes.into())),
                    Some(Out::Size(cols, rows)) => Some(Message::Text(json!({ "t": "size", "cols": cols, "rows": rows }).to_string().into())),
                    Some(Out::Exit) => {
                        open = None;
                        Some(Message::Text(json!({ "t": "exit" }).to_string().into()))
                    }
                    // Dropped for falling behind: the page reconnects and replays.
                    None => break,
                },
                msg = incoming.next() => {
                    let Some(Ok(msg)) = msg else { break };
                    let Message::Text(text) = msg else { continue };
                    let v: Value = serde_json::from_str(&text).unwrap_or_default();
                    handle(&ctx, &v, &mut open)
                }
            };
            if let Some(m) = msg {
                if sink.send(m).await.is_err() {
                    break;
                }
            }
        }
    }
    if let Some((pane, id, _)) = open.take() {
        unsubscribe(&pane, id);
    }
    let n = REMOTE.clients.fetch_sub(1, Ordering::SeqCst) - 1;
    ctx.host.clients(n);
}

fn handle(ctx: &Ctx, v: &Value, open: &mut Option<(String, u64, mpsc::Receiver<Out>)>) -> Option<Message> {
    match v["t"].as_str()? {
        "open" => {
            let pane = v["pane"].as_str()?.to_string();
            if let Some((old, id, _)) = open.take() {
                unsubscribe(&old, id);
            }
            let fit = size_of(&v["fit"]);
            let (id, rx, size) = subscribe(&pane, fit);
            *open = Some((pane.clone(), id, rx));
            let size = size.map(|(c, r)| json!({ "cols": c, "rows": r }));
            Some(Message::Text(json!({ "t": "opened", "pane": pane, "size": size }).to_string().into()))
        }
        "close" => {
            if let Some((pane, id, _)) = open.take() {
                unsubscribe(&pane, id);
            }
            None
        }
        "fit" => {
            let (pane, id, _) = open.as_ref()?;
            // Not a claim: a phone re-measures whenever its own layout shifts.
            set_fit(pane, *id, size_of(&v["fit"]));
            None
        }
        "claim" => {
            let (pane, id, _) = open.as_ref()?;
            claim(pane, *id);
            None
        }
        "in" => {
            let (pane, id, _) = open.as_ref()?;
            let _ = ctx.host.write(pane, v["d"].as_str()?.as_bytes());
            claim(pane, *id);
            None
        }
        "action" => {
            ctx.host.action(v["action"].clone());
            None
        }
        _ => None,
    }
}

/// Starts serving on `port` (stopping a running server first).
fn start(host: Arc<dyn Host>, port: u16, allow_lan: bool, token: String) -> Result<u16, String> {
    stop();
    *REMOTE.host.lock().unwrap() = Some(host.clone());
    let listener = std::net::TcpListener::bind(("0.0.0.0", port)).map_err(|e| format!("port {port}: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (stop_tx, stop_rx) = watch::channel(false);
    let ctx = Arc::new(Ctx { host, token, allow_lan, stop: stop_rx.clone() });
    let app = Router::new()
        .route("/pair", get(pair))
        .route("/ws", get(ws))
        .fallback(files)
        .with_state(ctx)
        .into_make_service_with_connect_info::<SocketAddr>();
    tauri::async_runtime::spawn(async move {
        let Ok(listener) = tokio::net::TcpListener::from_std(listener) else { return };
        let mut stop = stop_rx;
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = stop.changed().await;
            })
            .await;
    });
    *REMOTE.server.lock().unwrap() = Some(Running { port, stop: stop_tx });
    Ok(port)
}

/// Stops the server and ends every phone's session.
fn stop() {
    if let Some(r) = REMOTE.server.lock().unwrap().take() {
        let _ = r.stop.send(true);
    }
}

fn running_port() -> Option<u16> {
    REMOTE.server.lock().unwrap().as_ref().map(|r| r.port)
}

// ---------------------------------------------------------------- the app's side

fn token_path() -> std::path::PathBuf {
    crate::config::app_dir().join("remote-token")
}

fn new_token() -> String {
    use std::io::Read;
    let mut bytes = [0u8; 24];
    std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes)).expect("no /dev/urandom");
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let path = token_path();
    let _ = std::fs::create_dir_all(crate::config::app_dir());
    let _ = std::fs::write(&path, &token);
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    token
}

fn token() -> String {
    std::fs::read_to_string(token_path()).ok().map(|t| t.trim().to_string()).filter(|t| t.len() >= 32).unwrap_or_else(new_token)
}

struct AppHost(tauri::AppHandle);

impl Host for AppHost {
    fn write(&self, pane: &str, data: &[u8]) -> Result<(), String> {
        use tauri::Manager;
        crate::pty::write_to(&self.0.state::<crate::pty::PtyState>(), pane, data)
    }

    fn resize(&self, pane: &str, cols: u16, rows: u16) -> Result<(), String> {
        use tauri::Manager;
        crate::pty::resize_to(&self.0.state::<crate::pty::PtyState>(), pane, cols, rows)
    }

    fn action(&self, action: Value) {
        use tauri::Emitter;
        let _ = self.0.emit("remote-action", action);
    }

    fn asset(&self, path: &str) -> Option<(Vec<u8>, String)> {
        if cfg!(debug_assertions) {
            // `tauri dev` serves the frontend from Vite; use the last `vite build` instead.
            let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist").join(path);
            let bytes = std::fs::read(&file).ok()?;
            return Some((bytes, mime(path).to_string()));
        }
        self.0.asset_resolver().get(path.to_string()).map(|a| (a.bytes, a.mime_type))
    }

    fn clients(&self, n: usize) {
        use tauri::Emitter;
        let _ = self.0.emit("remote-clients", n);
    }
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript",
        "css" => "text/css",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub label: String,
    pub url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    enabled: bool,
    running: bool,
    port: Option<u16>,
    error: Option<String>,
    /// Addresses a phone can use, best first; each is a pairing link.
    links: Vec<Link>,
    /// The first link as a QR code.
    qr_svg: Option<String>,
    tailscale: bool,
    clients: usize,
}

/// This Mac's Tailscale address and MagicDNS name, if Tailscale is up.
fn tailscale() -> (Option<String>, Option<String>) {
    let ip = if_addrs::get_if_addrs().ok().into_iter().flatten().find_map(|i| match i.ip() {
        IpAddr::V4(v4) if !i.is_loopback() && v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1]) => Some(v4.to_string()),
        _ => None,
    });
    let name = ip.as_ref().and_then(|_| {
        let cli = ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale"]
            .into_iter()
            .find(|p| std::path::Path::new(p).exists())?;
        let out = std::process::Command::new(cli).args(["status", "--json"]).output().ok()?;
        let v: Value = serde_json::from_slice(&out.stdout).ok()?;
        v["Self"]["DNSName"].as_str().map(|n| n.trim_end_matches('.').to_string()).filter(|n| !n.is_empty())
    });
    (ip, name)
}

fn lan_ips() -> Vec<String> {
    if_addrs::get_if_addrs()
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|i| match i.ip() {
            IpAddr::V4(v4) if v4.is_private() => Some(v4.to_string()),
            _ => None,
        })
        .collect()
}

fn qr(text: &str) -> Option<String> {
    use qrcode::render::svg;
    let code = qrcode::QrCode::new(text.as_bytes()).ok()?;
    Some(code.render::<svg::Color>().min_dimensions(220, 220).quiet_zone(true).dark_color(svg::Color("#000")).light_color(svg::Color("#fff")).build())
}

fn status() -> RemoteStatus {
    let cfg = crate::config::load().remote;
    let port = running_port();
    let (ts_ip, ts_name) = tailscale();
    let mut links = Vec::new();
    if let Some(port) = port {
        let k = token();
        let mut add = |label: &str, host: &str| links.push(Link { label: label.into(), url: format!("http://{host}:{port}/pair?k={k}") });
        if let Some(ip) = &ts_ip {
            add("Tailscale", ip);
        }
        if let Some(name) = &ts_name {
            add("Tailscale name", name);
        }
        if cfg.allow_lan {
            for ip in lan_ips() {
                add("Same Wi-Fi", &ip);
            }
        }
    }
    RemoteStatus {
        enabled: cfg.enabled,
        running: port.is_some(),
        port,
        error: REMOTE.error.lock().unwrap().clone(),
        qr_svg: links.first().and_then(|l| qr(&l.url)),
        links,
        tailscale: ts_ip.is_some(),
        clients: REMOTE.clients.load(Ordering::SeqCst),
    }
}

/// Starts, restarts or stops the server to match the config.
fn apply(app: &tauri::AppHandle) {
    let cfg = crate::config::load().remote;
    let error = if cfg.enabled {
        start(Arc::new(AppHost(app.clone())), cfg.port, cfg.allow_lan, token()).err()
    } else {
        stop();
        None
    };
    *REMOTE.error.lock().unwrap() = error;
}

pub fn init(app: &tauri::AppHandle) {
    *REMOTE.host.lock().unwrap() = Some(Arc::new(AppHost(app.clone())));
    if crate::config::load().remote.enabled {
        apply(app);
    }
}

#[tauri::command]
pub async fn remote_status() -> RemoteStatus {
    tauri::async_runtime::spawn_blocking(status).await.map_err(|e| e.to_string()).unwrap()
}

/// After Settings saved the remote options.
#[tauri::command]
pub async fn remote_apply(app: tauri::AppHandle) -> RemoteStatus {
    apply(&app);
    remote_status().await
}

/// New pairing token: every paired phone has to scan the new code.
#[tauri::command]
pub async fn remote_reset_token(app: tauri::AppHandle) -> RemoteStatus {
    new_token();
    apply(&app);
    remote_status().await
}

#[tauri::command]
pub fn remote_snapshot(snapshot: Value) {
    set_snapshot(snapshot);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_local_tailscale_and_opted_in_lan_addresses_get_in() {
        let ok = |s: &str, lan| allowed(s.parse().unwrap(), lan);
        assert!(ok("127.0.0.1", false) && ok("::1", false));
        assert!(ok("100.101.102.103", false) && ok("fd7a:115c:a1e0::1", false));
        assert!(!ok("100.128.0.1", false), "just past Tailscale's range");
        assert!(!ok("192.168.1.20", false) && ok("192.168.1.20", true) && ok("10.0.0.2", true));
        assert!(!ok("8.8.8.8", true) && !ok("2001:4860::8888", true));
        assert!(ok("::ffff:100.64.0.1", false), "v4-mapped");
    }

    #[test]
    fn a_fitting_phone_holds_the_size_until_it_lets_go() {
        let pane = "fit-test";
        assert!(desk_resize(pane, 120, 40));
        let (a, mut rx_a, size) = subscribe(pane, Some((50, 30)));
        assert_eq!(size, Some((50, 30)), "the PTY takes the phone's size");
        assert!(!desk_resize(pane, 130, 42), "the desktop waits while a phone fits");
        let target = || REMOTE.mirrors.lock().unwrap()[pane].target();
        assert_eq!(target(), Some((50, 30)));
        let (b, _rx_b, _) = subscribe(pane, None);
        assert_eq!(target(), Some((50, 30)), "a mirroring phone doesn't take over");
        set_fit(pane, b, Some((60, 20)));
        assert_eq!(target(), Some((60, 20)), "the newest fitting phone wins");
        // Typing into the first phone takes the size back for it, and every phone hears the new size.
        claim(pane, a);
        assert_eq!(target(), Some((50, 30)));
        let sizes: Vec<(u16, u16)> = std::iter::from_fn(|| rx_a.try_recv().ok()).filter_map(|o| if let Out::Size(c, r) = o { Some((c, r)) } else { None }).collect();
        assert_eq!(sizes, [(50, 30), (60, 20), (50, 30)]);
        unsubscribe(pane, b);
        unsubscribe(pane, a);
        assert_eq!(target(), Some((130, 42)), "back to the desktop's last size");
        assert!(desk_resize(pane, 100, 30));
        exit(pane);
    }

    #[test]
    fn a_pane_never_resized_since_launch_still_gets_its_size_back() {
        let pane = "spawn-test";
        spawned(pane, 103, 42);
        let (a, _rx, _) = subscribe(pane, Some((54, 14)));
        let applied = || REMOTE.mirrors.lock().unwrap()[pane].applied;
        assert_eq!(applied(), Some((54, 14)));
        unsubscribe(pane, a);
        assert_eq!(applied(), Some((103, 42)), "the desktop's size, not the phone's");
        exit(pane);
    }

    #[test]
    fn opening_replays_what_came_before() {
        let pane = "replay-test";
        tap(pane, b"hello ");
        let (_, mut rx, _) = subscribe(pane, None);
        tap(pane, b"world");
        let mut got = Vec::new();
        while let Ok(Out::Data(d)) = rx.try_recv() {
            got.extend(d);
        }
        assert_eq!(got, b"hello world");
        exit(pane);
        assert!(matches!(rx.try_recv(), Ok(Out::Exit)));
    }

    struct Demo {
        writers: Mutex<HashMap<String, Box<dyn std::io::Write + Send>>>,
        masters: Mutex<HashMap<String, Box<dyn portable_pty::MasterPty + Send>>>,
    }

    impl Host for Demo {
        fn write(&self, pane: &str, data: &[u8]) -> Result<(), String> {
            let mut w = self.writers.lock().unwrap();
            let w = w.get_mut(pane).ok_or("no pane")?;
            w.write_all(data).and_then(|_| w.flush()).map_err(|e| e.to_string())
        }
        fn resize(&self, pane: &str, cols: u16, rows: u16) -> Result<(), String> {
            let m = self.masters.lock().unwrap();
            m.get(pane).ok_or("no pane")?.resize(portable_pty::PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
        }
        fn action(&self, action: Value) {
            println!("action: {action}");
        }
        fn asset(&self, path: &str) -> Option<(Vec<u8>, String)> {
            let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist").join(path);
            Some((std::fs::read(file).ok()?, mime(path).to_string()))
        }
        fn clients(&self, n: usize) {
            println!("clients: {n}");
        }
    }

    /// `cargo test remote_demo -- --ignored --nocapture`: serves the remote against real
    /// shells (no app) on REMOTE_DEMO_PORT, for trying the phone page in a browser.
    #[test]
    #[ignore]
    fn remote_demo() {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        let demo = Arc::new(Demo { writers: Default::default(), masters: Default::default() });
        let mut panes = Vec::new();
        for (pane, title, cmd) in [("demo-1", "claude", std::env::var("REMOTE_DEMO_CMD").unwrap_or("zsh".into())), ("demo-2", "zsh", "zsh".into())] {
            let pair = native_pty_system().openpty(PtySize { rows: 40, cols: 120, pixel_width: 0, pixel_height: 0 }).unwrap();
            let mut c = CommandBuilder::new("/bin/zsh");
            c.args(["-c", &cmd]);
            c.env("TERM", "xterm-256color");
            c.cwd(std::env::var("HOME").unwrap());
            let child = pair.slave.spawn_command(c).unwrap();
            std::mem::forget(child);
            let mut reader = pair.master.try_clone_reader().unwrap();
            demo.writers.lock().unwrap().insert(pane.into(), pair.master.take_writer().unwrap());
            demo.masters.lock().unwrap().insert(pane.into(), pair.master);
            spawned(pane, 120, 40);
            std::thread::spawn(move || {
                let mut buf = vec![0u8; 65536];
                while let Ok(n) = reader.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    tap(pane, &buf[..n]);
                }
                exit(pane);
            });
            panes.push(json!({ "id": pane, "title": title, "where": "AureliaSpace", "tab": 1, "status": if pane == "demo-1" { "needs_input" } else { "shell" }, "message": if pane == "demo-1" { "Claude needs your permission to use Bash" } else { "" }, "account": if pane == "demo-1" { "claude-a" } else { "" } }));
        }
        use std::io::Read;
        set_snapshot(json!({ "panes": panes, "accounts": ["claude-a", "claude-b"], "projects": [{ "name": "AureliaSpace", "path": "~/Downloads/AureliaSpace" }] }));
        let port = std::env::var("REMOTE_DEMO_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(4848);
        let token = "0".repeat(48);
        let port = start(demo, port, true, token.clone()).unwrap();
        println!("http://127.0.0.1:{port}/pair?k={token}");
        std::thread::sleep(Duration::from_secs(std::env::var("REMOTE_DEMO_SECS").ok().and_then(|s| s.parse().ok()).unwrap_or(600)));
    }
}
