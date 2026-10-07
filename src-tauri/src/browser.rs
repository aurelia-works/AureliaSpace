//! Built-in browser panes: each is a native child webview of the main window, positioned
//! by the frontend over the pane's DOM rect. External pages get no IPC: the capability
//! file only grants permissions to local app URLs.

use serde::Serialize;
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, WebviewUrl};

#[derive(Clone, Serialize)]
struct NavEvent {
    pane: String,
    url: String,
    loading: bool,
}

fn label(pane: &str) -> String {
    format!("browser-{pane}")
}

fn parse(url: &str) -> Result<tauri::Url, String> {
    let u: tauri::Url = url.parse().map_err(|e| format!("invalid url: {e}"))?;
    match u.scheme() {
        "http" | "https" => Ok(u),
        s => Err(format!("unsupported scheme: {s}")),
    }
}

fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
    Rect {
        position: LogicalPosition::new(x, y).into(),
        size: LogicalSize::new(w.max(1.0), h.max(1.0)).into(),
    }
}

/// Creates the pane's webview if needed (hidden until the frontend has measured it).
#[tauri::command]
pub fn browser_open(app: AppHandle, pane: String, url: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let lbl = label(&pane);
    if app.get_webview(&lbl).is_some() {
        return Ok(());
    }
    let url = parse(&url)?;
    let window = app.get_window("main").ok_or("main window missing")?;
    let (nav_app, nav_pane) = (app.clone(), pane.clone());
    let (load_app, load_pane) = (app.clone(), pane.clone());
    let builder = WebviewBuilder::new(&lbl, WebviewUrl::External(url))
        .on_navigation(move |u| {
            let _ = nav_app.emit("browser-nav", NavEvent { pane: nav_pane.clone(), url: u.to_string(), loading: true });
            true
        })
        .on_page_load(move |wv, payload| {
            let loading = payload.event() == PageLoadEvent::Started;
            let _ = load_app.emit(
                "browser-nav",
                NavEvent { pane: load_pane.clone(), url: payload.url().to_string(), loading },
            );
            let _ = wv;
        });
    let r = rect(x, y, w, h);
    window.add_child(builder, r.position, r.size).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn browser_bounds(app: AppHandle, pane: String, x: f64, y: f64, w: f64, h: f64) {
    if let Some(wv) = app.get_webview(&label(&pane)) {
        let _ = wv.set_bounds(rect(x, y, w, h));
    }
}

#[tauri::command]
pub fn browser_visible(app: AppHandle, pane: String, visible: bool) {
    if let Some(wv) = app.get_webview(&label(&pane)) {
        let _ = if visible { wv.show() } else { wv.hide() };
    }
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, pane: String, url: String) -> Result<(), String> {
    let url = parse(&url)?;
    match app.get_webview(&label(&pane)) {
        Some(wv) => wv.navigate(url).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// action: "back" | "forward" | "reload"
#[tauri::command]
pub fn browser_action(app: AppHandle, pane: String, action: String) {
    let Some(wv) = app.get_webview(&label(&pane)) else { return };
    let _ = match action.as_str() {
        "back" => wv.eval("history.back()"),
        "forward" => wv.eval("history.forward()"),
        "reload" => wv.reload(),
        _ => Ok(()),
    };
}

#[tauri::command]
pub fn browser_close(app: AppHandle, pane: String) {
    if let Some(wv) = app.get_webview(&label(&pane)) {
        let _ = wv.close();
    }
}
