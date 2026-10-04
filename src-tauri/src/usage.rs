//! Per-account 5h / 7d usage. Reuses the existing `fetch-usage.sh`, which reads the
//! account's keychain entry (`Claude Code-credentials-<sha256(dir)[:8]>`) and calls
//! Anthropic's usage endpoint. This module never touches credentials itself: it only
//! runs the script and reads the cache file it writes.

use crate::config;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, SystemTime};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub five_hour: Option<f64>,
    pub seven_day: Option<f64>,
    pub five_hour_resets_at: Option<String>,
    pub seven_day_resets_at: Option<String>,
    /// Unix seconds when the cache file was written.
    pub updated_at: u64,
}

/// Same suffix rule as fetch-usage.sh.
fn cache_suffix(acct: &config::Account) -> String {
    if acct.is_default() {
        return "default".into();
    }
    let digest = Sha256::digest(acct.resolved_dir().as_bytes());
    digest.iter().take(4).map(|b| format!("{b:02x}")).collect()
}

fn cache_path(acct: &config::Account) -> PathBuf {
    PathBuf::from(format!("/tmp/.claude_usage_cache_{}", cache_suffix(acct)))
}

fn cache_age(path: &PathBuf) -> Option<(Duration, u64)> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let age = SystemTime::now().duration_since(modified).unwrap_or_default();
    let ts = modified.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_secs();
    Some((age, ts))
}

fn read_cache(path: &PathBuf) -> Option<Usage> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut lines = text.lines();
    let num = |s: Option<&str>| s.and_then(|v| v.trim().parse::<f64>().ok());
    let txt = |s: Option<&str>| s.map(str::trim).filter(|v| !v.is_empty()).map(String::from);
    let five_hour = num(lines.next());
    let seven_day = num(lines.next());
    let five_hour_resets_at = txt(lines.next());
    let seven_day_resets_at = txt(lines.next());
    let updated_at = cache_age(path).map(|(_, ts)| ts).unwrap_or(0);
    Some(Usage { five_hour, seven_day, five_hour_resets_at, seven_day_resets_at, updated_at })
}

#[tauri::command]
pub async fn fetch_usage(account: String, force: bool) -> Result<Option<Usage>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = config::load();
        let acct = cfg
            .accounts
            .iter()
            .find(|a| a.name == account)
            .ok_or_else(|| format!("unknown account '{account}'"))?
            .clone();
        let cache = cache_path(&acct);
        let max_age = Duration::from_secs(cfg.usage_refresh_seconds.max(30).saturating_sub(10));
        let fresh = cache_age(&cache).is_some_and(|(age, _)| age < max_age);

        if force || !fresh {
            let script = config::expand_path(&cfg.usage_script);
            if PathBuf::from(&script).is_file() {
                let mut cmd = Command::new("/bin/sh");
                cmd.arg(&script);
                if acct.is_default() {
                    cmd.env_remove("CLAUDE_CONFIG_DIR");
                } else {
                    cmd.env("CLAUDE_CONFIG_DIR", acct.resolved_dir());
                }
                // The script's own curl has a 3s timeout; output is discarded.
                let _ = cmd.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();
            }
        }
        Ok(read_cache(&cache))
    })
    .await
    .map_err(|e| e.to_string())?
}
