//! macOS privacy grants. A terminal runs arbitrary commands that touch Downloads,
//! Documents, other apps' data and so on; each of those is a separate prompt (and the
//! "data from other apps" one never sticks). Full Disk Access covers them all.

use std::process::Command;

/// The system TCC folder is readable only by processes with Full Disk Access, and the attempt
/// never prompts. Only "not permitted" counts as missing: macOS 27 dropped the per-user TCC.db,
/// so a missing file says nothing about the grant.
#[tauri::command]
pub fn has_full_disk_access() -> bool {
    match std::fs::read_dir("/Library/Application Support/com.apple.TCC") {
        Err(e) => e.kind() != std::io::ErrorKind::PermissionDenied,
        Ok(_) => true,
    }
}

#[tauri::command]
pub fn open_full_disk_access_settings() -> Result<(), String> {
    Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
