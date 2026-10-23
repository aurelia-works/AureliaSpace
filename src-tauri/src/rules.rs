//! Claude Code's saved permission rules, like the CLI's `/permissions`: what "Always" in a
//! chat wrote (the project's `.claude/settings.local.json`), the project's shared
//! `.claude/settings.json`, and the account's own `settings.json`. Claude Code reloads these
//! files when they change, so removing a rule here takes effect in running chats too.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value};

use crate::config;

const KINDS: [&str; 3] = ["allow", "ask", "deny"];

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuleFile {
    /// `local`, `project` or `user`.
    scope: &'static str,
    path: String,
    allow: Vec<String>,
    ask: Vec<String>,
    deny: Vec<String>,
}

fn files(cwd: &Path, user_dir: &Path) -> [(&'static str, PathBuf); 3] {
    [
        ("local", cwd.join(".claude/settings.local.json")),
        ("project", cwd.join(".claude/settings.json")),
        ("user", user_dir.join("settings.json")),
    ]
}

fn read(path: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn list(path: &Path, kind: &str) -> Vec<String> {
    let rules = read(path).and_then(|v| v["permissions"][kind].as_array().cloned()).unwrap_or_default();
    rules.iter().filter_map(|r| r.as_str().map(String::from)).collect()
}

fn collect(cwd: &Path, user_dir: &Path) -> Vec<RuleFile> {
    let mut out = vec![];
    // The default account's folder may also be the project's own .claude (a chat in ~).
    let mut seen = vec![];
    for (scope, path) in files(cwd, user_dir) {
        if seen.contains(&path) {
            continue;
        }
        seen.push(path.clone());
        out.push(RuleFile { scope, allow: list(&path, "allow"), ask: list(&path, "ask"), deny: list(&path, "deny"), path: path.display().to_string() });
    }
    out
}

fn user_dir(account: Option<&str>) -> PathBuf {
    let cfg = config::load();
    let dir = account.and_then(|n| cfg.accounts.iter().find(|a| a.name == n)).map(|a| a.resolved_dir());
    PathBuf::from(dir.unwrap_or_else(|| config::expand_path("~/.claude")))
}

fn remove(path: &Path, kind: &str, rule: &str) -> Result<(), String> {
    let mut v = read(path).ok_or_else(|| format!("couldn't read {}", path.display()))?;
    let list = v.get_mut("permissions").and_then(|p| p.get_mut(kind)).and_then(Value::as_array_mut).ok_or("no such rule")?;
    let before = list.len();
    list.retain(|r| r.as_str() != Some(rule));
    if list.len() == before {
        return Err("no such rule".into());
    }
    if list.is_empty() {
        let perms = v["permissions"].as_object_mut().expect("checked above");
        perms.remove(kind);
        if perms.is_empty() {
            v.as_object_mut().map(|o: &mut Map<String, Value>| o.remove("permissions"));
        }
    }
    let text = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    fs::write(path, text + "\n").map_err(|e| format!("couldn't save {}: {e}", path.display()))
}

#[tauri::command]
pub fn permission_rules(cwd: String, account: Option<String>) -> Vec<RuleFile> {
    collect(Path::new(&config::expand_path(&cwd)), &user_dir(account.as_deref()))
}

/// Removes one rule. Only the three files `permission_rules` lists for this chat can be changed.
#[tauri::command]
pub fn remove_permission_rule(cwd: String, account: Option<String>, path: String, kind: String, rule: String) -> Result<(), String> {
    let known = files(Path::new(&config::expand_path(&cwd)), &user_dir(account.as_deref()));
    let target = known.iter().map(|(_, p)| p).find(|p| p.display().to_string() == path).ok_or("not a settings file of this chat")?;
    if !KINDS.contains(&kind.as_str()) {
        return Err(format!("unknown rule kind '{kind}'"));
    }
    remove(target, &kind, &rule)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aurelia-rules-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("proj/.claude")).unwrap();
        fs::create_dir_all(dir.join("acct")).unwrap();
        dir
    }

    #[test]
    fn lists_rules_per_file_and_removes_one_keeping_other_settings() {
        let dir = temp("list");
        let local = dir.join("proj/.claude/settings.local.json");
        fs::write(&local, r#"{"permissions":{"allow":["Bash(npm test)","Read"],"deny":["Bash(rm *)"]},"model":"opus"}"#).unwrap();
        fs::write(dir.join("acct/settings.json"), r#"{"permissions":{"ask":["WebFetch"]}}"#).unwrap();

        let got = collect(&dir.join("proj"), &dir.join("acct"));
        assert_eq!(got.iter().map(|f| f.scope).collect::<Vec<_>>(), ["local", "project", "user"]);
        assert_eq!(got[0].allow, ["Bash(npm test)", "Read"]);
        assert_eq!(got[0].deny, ["Bash(rm *)"]);
        assert!(got[1].allow.is_empty(), "a missing file lists nothing");
        assert_eq!(got[2].ask, ["WebFetch"]);

        remove(&local, "allow", "Read").unwrap();
        remove(&local, "deny", "Bash(rm *)").unwrap();
        let v = read(&local).unwrap();
        assert_eq!(v["permissions"], serde_json::json!({ "allow": ["Bash(npm test)"] }));
        assert_eq!(v["model"], "opus");
        assert!(remove(&local, "allow", "Read").is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
