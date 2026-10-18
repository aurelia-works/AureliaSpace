//! Prompt links: `aureliaspace://new?prompt=…` (the URL scheme is declared in Info.plist).
//! macOS hands the URL to the app; it waits here until the frontend takes it, because a
//! link can be what launched the app. The frontend only ever drafts the prompt, never sends it.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

static PENDING: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn opened(app: &AppHandle, urls: impl IntoIterator<Item = String>) {
    let urls: Vec<String> = urls.into_iter().filter(|u| u.starts_with("aureliaspace:")).collect();
    if urls.is_empty() {
        return;
    }
    PENDING.lock().unwrap().extend(urls);
    let _ = app.emit_to("main", "prompt-links", ());
}

#[tauri::command]
pub fn take_prompt_links() -> Vec<String> {
    std::mem::take(&mut *PENDING.lock().unwrap())
}
