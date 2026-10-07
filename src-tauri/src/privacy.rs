//! macOS privacy grants. A terminal runs arbitrary commands that touch Downloads,
//! Documents, other apps' data and so on; each of those is a separate prompt (and the
//! "data from other apps" one never sticks). Full Disk Access covers them all.

use std::process::Command;

/// TCC.db is readable only by processes with Full Disk Access, and the attempt never prompts.
#[tauri::command]
pub fn has_full_disk_access() -> bool {
    let Some(home) = std::env::var_os("HOME") else { return true };
    let db = std::path::Path::new(&home).join("Library/Application Support/com.apple.TCC/TCC.db");
    std::fs::File::open(db).is_ok()
}

#[tauri::command]
pub fn open_full_disk_access_settings() -> Result<(), String> {
    Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
