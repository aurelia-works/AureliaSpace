mod agents;
mod browser;
mod config;
mod discord;
mod files;
mod git;
mod handoff;
mod hud;
mod integration;
mod privacy;
mod pty;
mod suggest;
mod transcript;
mod usage;
mod voice;
mod which;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, RunEvent};

/// The default macOS menu binds ⌘W to "Close Window" and ⌘A to native select-all,
/// which would shadow the terminal's own shortcuts. This menu keeps only what the
/// webview needs natively (copy/paste via the Edit menu) plus app basics.
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
    let app_menu = Submenu::with_items(
        app,
        "AureliaSpace",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About AureliaSpace"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &window])
}

/// Suppresses WKWebView's browser context menu (Reload, Play All Animations, Inspect) in
/// every window so the app behaves like a native one. Text fields keep their Cut/Copy/Paste
/// menu; debug builds keep the menu when Option is held, for Inspect Element.
fn no_webview_context_menu<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let allow_inspect = if cfg!(debug_assertions) { "e.altKey" } else { "false" };
    tauri::plugin::Builder::new("no-context-menu")
        .js_init_script(format!(
            r#"window.addEventListener("contextmenu", (e) => {{
  if ({allow_inspect}) return;
  const t = e.target;
  const editable = t instanceof HTMLElement && !t.closest(".xterm") &&
    (t.isContentEditable || t.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea"));
  if (!editable) e.preventDefault();
}}, true);"#
        ))
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(no_webview_context_menu())
        .manage(pty::PtyState::default())
        .manage(discord::DiscordState::default())
        .setup(|app| {
            if let Err(e) = integration::install() {
                eprintln!("[aurelia] failed to install shell integration: {e}");
            }
            config::load(); // writes the default config on first run
            integration::watch_events(app.handle().clone());
            voice::listen(app.handle().clone());
            app.set_menu(build_menu(app.handle())?)?;
            app.on_menu_event(|app, event| {
                if event.id() == "settings" {
                    let _ = app.emit("menu-settings", ());
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            browser::browser_open,
            browser::browser_bounds,
            browser::browser_visible,
            browser::browser_navigate,
            browser::browser_action,
            browser::browser_close,
            discord::discord_set,
            files::pick_folder,
            privacy::has_full_disk_access,
            privacy::open_full_disk_access_settings,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_write_binary,
            pty::pty_resize,
            pty::pty_kill,
            config::get_config,
            config::save_config,
            config::load_state,
            config::save_state,
            config::reveal_config,
            config::project_root,
            files::list_dir,
            files::resolve_paths,
            files::open_path,
            files::open_url,
            git::git_info,
            git::create_worktree,
            git::git_diff,
            usage::fetch_usage,
            hud::hud_show,
            hud::hud_hide,
            hud::hud_resize,
            hud::focus_main,
            transcript::transcript_usage,
            handoff::handoff_prepare,
            handoff::handoff_summary,
            suggest::suggest_command,
            suggest::set_api_key,
            suggest::has_api_key,
            voice::voice_toggle,
            voice::voice_installed,
            which::which,
            agents::set_agent_key,
            agents::agent_keys_present,
        ])
        .build(tauri::generate_context!())
        .expect("error while building AureliaSpace");

    app.run(|handle, event| {
        if let RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } = &event {
            if label == "main" {
                hud::close(handle);
            }
        }
        if let RunEvent::Exit = event {
            pty::kill_all(&handle.state::<pty::PtyState>());
            voice::cleanup();
        }
    });
}
