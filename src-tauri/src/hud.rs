//! Floating session HUD: a small always-on-top panel pinned to the right screen edge.
//! The webview (`hud.html`) is state-less; the main window feeds it over events.

use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const WIDTH: f64 = 300.0;
const MARGIN: f64 = 12.0;
const MIN_H: f64 = 60.0;
const MAX_H: f64 = 640.0;

fn ensure(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(w) = app.get_webview_window("hud") {
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, "hud", WebviewUrl::App("hud.html".into()))
        .title("AureliaSpace HUD")
        .inner_size(WIDTH, 120.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        // Never becomes key, so showing or clicking it doesn't pull focus from the app you're in.
        .focusable(false)
        .accept_first_mouse(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())
}

/// Top-right of the work area (below the menu bar) of the monitor the main window is on.
fn place(app: &AppHandle, hud: &WebviewWindow) {
    let mon = app
        .get_webview_window("main")
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| hud.primary_monitor().ok().flatten());
    let Some(mon) = mon else { return };
    let wa = mon.work_area();
    let s = mon.scale_factor();
    let x = wa.position.x as f64 + wa.size.width as f64 - (WIDTH + MARGIN) * s;
    let y = wa.position.y as f64 + MARGIN * s;
    let _ = hud.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

#[tauri::command]
pub fn hud_show(app: AppHandle) -> Result<(), String> {
    let created = app.get_webview_window("hud").is_none();
    let hud = ensure(&app)?;
    if created {
        place(&app, &hud);
    }
    hud.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hud_hide(app: AppHandle) {
    if let Some(hud) = app.get_webview_window("hud") {
        let _ = hud.hide();
    }
}

#[tauri::command]
pub fn hud_resize(app: AppHandle, height: f64) {
    if let Some(hud) = app.get_webview_window("hud") {
        let _ = hud.set_size(LogicalSize::new(WIDTH, height.clamp(MIN_H, MAX_H)));
    }
}

/// Brings the main window forward (from the HUD, which can't take focus itself).
#[tauri::command]
pub fn focus_main(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn close(app: &AppHandle) {
    if let Some(hud) = app.get_webview_window("hud") {
        let _ = hud.destroy();
    }
}
