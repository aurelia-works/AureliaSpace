//! File browser listing, resolving file references in terminal output, and opening
//! files in the user's editor or URLs in the browser.

use crate::config::{self, expand_path};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const MAX_ENTRIES: usize = 2000;
const SKIP: [&str; 2] = [".git", ".DS_Store"];

#[derive(Serialize)]
pub struct Entry {
    name: String,
    path: String,
    dir: bool,
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let dir = PathBuf::from(expand_path(&path));
    let mut entries: Vec<Entry> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| !SKIP.contains(&e.file_name().to_string_lossy().as_ref()))
        .map(|e| {
            let path = e.path();
            // Follow symlinks so linked folders expand like real ones.
            let dir = fs::metadata(&path).map(|m| m.is_dir()).unwrap_or(false);
            Entry { name: e.file_name().to_string_lossy().into_owned(), path: path.to_string_lossy().into_owned(), dir }
        })
        .take(MAX_ENTRIES)
        .collect();
    entries.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

fn resolve(cwd: &Path, candidate: &str) -> Option<String> {
    let expanded = expand_path(candidate);
    let p = Path::new(&expanded);
    let full = if p.is_absolute() { p.to_path_buf() } else { cwd.join(p) };
    if full.exists() {
        return Some(full.to_string_lossy().into_owned());
    }
    // `a/src/x.ts` / `b/src/x.ts` from diff headers.
    let rest = candidate.strip_prefix("a/").or_else(|| candidate.strip_prefix("b/"))?;
    let full = cwd.join(rest);
    full.exists().then(|| full.to_string_lossy().into_owned())
}

/// For each candidate path seen in terminal output, its absolute path if it exists.
#[tauri::command]
pub fn resolve_paths(cwd: String, candidates: Vec<String>) -> Vec<Option<String>> {
    let cwd = PathBuf::from(expand_path(&cwd));
    candidates.iter().map(|c| resolve(&cwd, c)).collect()
}

/// Directories open in Finder; files open in the configured editor, else Cursor or
/// VS Code (jumping to the line), else the default app. Runs through a login shell
/// so editors installed via Homebrew are on PATH.
#[tauri::command]
pub fn open_path(path: String, line: Option<u32>, col: Option<u32>) -> Result<(), String> {
    let path = expand_path(&path);
    if Path::new(&path).is_dir() {
        return Command::new("open").arg(&path).spawn().map(|_| ()).map_err(|e| e.to_string());
    }
    let target = match (line, col) {
        (Some(l), Some(c)) => format!("{path}:{l}:{c}"),
        (Some(l), None) => format!("{path}:{l}"),
        _ => path.clone(),
    };
    let editor = config::load().editor;
    let script = if editor.trim().is_empty() {
        r#"export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/Applications/Cursor.app/Contents/Resources/app/bin:/Applications/Visual Studio Code.app/Contents/Resources/app/bin"
if command -v cursor >/dev/null 2>&1; then exec cursor -g "$1"
elif command -v code >/dev/null 2>&1; then exec code -g "$1"
else exec open "$2"; fi"#
            .to_string()
    } else {
        // `{line}`-style placeholders are not needed: "$1" is path[:line[:col]].
        format!("{} \"$1\"", editor.trim())
    };
    Command::new("/bin/zsh")
        .args(["-lc", &script, "aurelia-open", &target, &path])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")) {
        return Err("only http(s) and mailto links can be opened".into());
    }
    Command::new("open").arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Native "choose folder" dialog via AppleScript (no dialog plugin needed). Returns None on cancel.
#[tauri::command]
pub async fn pick_folder(start: Option<String>) -> Option<String> {
    let mut script = String::from("POSIX path of (choose folder with prompt \"Choose a workspace folder\"");
    if let Some(dir) = start.map(|s| crate::config::expand_path(&s)).filter(|d| std::path::Path::new(d).is_dir()) {
        script.push_str(&format!(" default location (POSIX file \"{}\")", dir.replace('\\', "\\\\").replace('"', "\\\"")));
    }
    script.push(')');
    let out = std::process::Command::new("osascript").arg("-e").arg(&script).output().ok()?;
    if !out.status.success() {
        return None; // user cancelled
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!path.is_empty()).then(|| crate::config::expand_path(&path))
}
