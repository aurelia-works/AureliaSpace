use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path};

#[derive(Serialize)]
pub struct UsageEntry {
    id: String,
    model: String,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_input_tokens: u64,
    cache_creation_input_tokens: u64,
    /// Part of the cache write billed at the 1-hour TTL rate.
    cache_creation_1h_tokens: u64,
    timestamp: String,
}

#[derive(Serialize)]
pub struct UsageBatch {
    entries: Vec<UsageEntry>,
    offset: u64,
}

/// Only transcripts under `<.claude*>/projects/` may be read; this isn't a general file reader.
fn allowed(path: &Path) -> bool {
    let comps: Vec<_> = path.components().collect();
    let Some(i) = comps.iter().position(|c| matches!(c, Component::Normal(n) if n.to_string_lossy().starts_with(".claude"))) else {
        return false;
    };
    matches!(comps.get(i + 1), Some(Component::Normal(n)) if *n == "projects")
        && path.extension().is_some_and(|e| e == "jsonl")
}

/// Assistant-message usage appended to a Claude transcript since `offset`.
#[tauri::command]
pub fn transcript_usage(path: String, offset: u64) -> Result<UsageBatch, String> {
    let real = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !allowed(&real) {
        return Err("not a Claude transcript".into());
    }
    let mut file = std::fs::File::open(&real).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let start = if offset > len { 0 } else { offset };
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    // A line still being written has no newline yet; leave it for the next poll.
    let end = buf.iter().rposition(|b| *b == b'\n').map(|i| i + 1).unwrap_or(0);
    let mut entries: Vec<UsageEntry> = Vec::new();
    for line in buf[..end].split(|b| *b == b'\n') {
        let Ok(v) = serde_json::from_slice::<Value>(line) else { continue };
        if v["type"] != "assistant" {
            continue;
        }
        let m = &v["message"];
        let u = &m["usage"];
        if !u.is_object() {
            continue;
        }
        let n = |k: &str| u[k].as_u64().unwrap_or(0);
        let entry = UsageEntry {
            id: m["id"].as_str().unwrap_or("").to_string(),
            model: m["model"].as_str().unwrap_or("").to_string(),
            input_tokens: n("input_tokens"),
            output_tokens: n("output_tokens"),
            cache_read_input_tokens: n("cache_read_input_tokens"),
            cache_creation_input_tokens: n("cache_creation_input_tokens"),
            cache_creation_1h_tokens: u["cache_creation"]["ephemeral_1h_input_tokens"].as_u64().unwrap_or(0),
            timestamp: v["timestamp"].as_str().unwrap_or("").to_string(),
        };
        // One line per content block repeats the message; the last carries the final counts.
        match entries.iter_mut().find(|e| !entry.id.is_empty() && e.id == entry.id) {
            Some(prev) => *prev = entry,
            None => entries.push(entry),
        }
    }
    Ok(UsageBatch { entries, offset: start + end as u64 })
}
