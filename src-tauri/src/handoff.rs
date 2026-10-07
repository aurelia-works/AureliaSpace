//! "Switch accounts, keep the thread": copies a session transcript into another
//! account's config dir so `claude --resume <id>` there continues the same
//! conversation. Only the transcript moves; each account keeps its own sign-in
//! (credentials are never read or copied).

use crate::config;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub session_id: String,
    /// Where the copy now lives, inside the target account.
    pub path: String,
}

/// `<configDir>/projects/<project>/<session>.jsonl` under a `.claude*` dir.
fn is_transcript(path: &Path) -> bool {
    let comps: Vec<_> = path.components().collect();
    let Some(i) = comps.iter().position(|c| matches!(c, Component::Normal(n) if n.to_string_lossy().starts_with(".claude"))) else {
        return false;
    };
    matches!(comps.get(i + 1), Some(Component::Normal(n)) if *n == "projects") && path.extension().is_some_and(|e| e == "jsonl")
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let (src, dst) = (entry.path(), to.join(entry.file_name()));
        if entry.file_type()?.is_dir() {
            copy_dir(&src, &dst)?;
        } else {
            fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

/// Copies the transcript (and its sidecar `<session>/` dir of tool results) into the
/// same project folder name under `to_account`. The original is never modified; the
/// project folder name is taken from the source path, so Claude's cwd encoding is
/// preserved exactly.
#[tauri::command]
pub fn handoff_prepare(transcript_path: String, to_account: String) -> Result<Prepared, String> {
    let src = fs::canonicalize(&transcript_path).map_err(|e| format!("transcript not found: {e}"))?;
    if !is_transcript(&src) {
        return Err("not a Claude transcript".into());
    }
    let cfg = config::load();
    let target = cfg
        .accounts
        .iter()
        .find(|a| a.name == to_account)
        .ok_or_else(|| format!("unknown account '{to_account}'"))?;
    let file = src.file_name().ok_or("bad transcript path")?;
    let project = src.parent().and_then(|p| p.file_name()).ok_or("bad transcript path")?;
    let session_id = src.file_stem().ok_or("bad transcript path")?.to_string_lossy().into_owned();

    let dest_dir = PathBuf::from(target.resolved_dir()).join("projects").join(project);
    let dest = dest_dir.join(file);
    if fs::canonicalize(&dest).is_ok_and(|d| d == src) {
        // Same account: nothing to copy.
        return Ok(Prepared { session_id, path: dest.to_string_lossy().into_owned() });
    }
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    // Copy to a temp name first so a half-written file is never picked up as a session.
    let tmp = dest.with_extension("jsonl.tmp");
    fs::copy(&src, &tmp).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    let side = src.with_extension("");
    if side.is_dir() {
        let _ = copy_dir(&side, &dest.with_extension(""));
    }
    Ok(Prepared { session_id, path: dest.to_string_lossy().into_owned() })
}

fn text_of(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter(|p| p["type"] == "text")
            .filter_map(|p| p["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Recent plain conversation text (user and assistant turns, no tool traffic), oldest
/// first, trimmed to roughly `max_chars`. Used to seed a new session when `--resume`
/// isn't possible.
#[tauri::command]
pub fn handoff_summary(transcript_path: String, max_chars: usize) -> Result<String, String> {
    let real = fs::canonicalize(&transcript_path).map_err(|e| e.to_string())?;
    if !is_transcript(&real) {
        return Err("not a Claude transcript".into());
    }
    let mut file = fs::File::open(&real).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    // Tool results make transcripts huge; the tail is enough for "where were we".
    let start = len.saturating_sub(2 * 1024 * 1024);
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let mut turns: Vec<String> = Vec::new();
    // The first line may be cut by the seek.
    for line in buf.split(|b| *b == b'\n').skip(usize::from(start > 0)) {
        let Ok(v) = serde_json::from_slice::<Value>(line) else { continue };
        let who = match v["type"].as_str() {
            Some("user") => "User",
            Some("assistant") => "Assistant",
            _ => continue,
        };
        if v["isSidechain"] == true || v["isMeta"] == true {
            continue;
        }
        let text = text_of(&v["message"]["content"]);
        let text = text.trim();
        if text.is_empty() || text.starts_with('<') {
            continue;
        }
        turns.push(format!("{who}: {text}"));
    }
    let mut out: Vec<String> = Vec::new();
    let mut used = 0;
    for turn in turns.iter().rev() {
        let t: String = turn.chars().take(1500).collect();
        used += t.chars().count();
        if used > max_chars && !out.is_empty() {
            break;
        }
        out.push(t);
    }
    out.reverse();
    Ok(out.join("\n\n"))
}
