//! IDE mode backends: reading and saving files for editor panes, project search
//! (ripgrep), a Problems list from the project's own checkers (tsc, cargo check), and a
//! readable thread of a Claude conversation from its transcript.

use crate::{config::expand_path, which};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::UNIX_EPOCH;

const MAX_EDIT_BYTES: u64 = 5 * 1024 * 1024;
const MAX_MATCHES: usize = 1000;
const MAX_PROBLEMS: usize = 500;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    text: String,
    mtime_ms: f64,
}

fn mtime_ms(path: &Path) -> Result<f64, String> {
    let m = fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(m.modified().map_err(|e| e.to_string())?.duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0))
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<TextFile, String> {
    let p = PathBuf::from(expand_path(&path));
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        return Err("That's a folder.".into());
    }
    if meta.len() > MAX_EDIT_BYTES {
        return Err(format!("{} MB is too big to edit here.", meta.len() / (1024 * 1024)));
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    if bytes[..bytes.len().min(8192)].contains(&0) {
        return Err("Binary file.".into());
    }
    let text = String::from_utf8(bytes).map_err(|_| "Not UTF-8 text.".to_string())?;
    Ok(TextFile { text, mtime_ms: mtime_ms(&p)? })
}

/// Cheap change check for an open editor (the whole file is only read when it changed).
#[tauri::command]
pub fn file_mtime(path: String) -> Result<f64, String> {
    mtime_ms(Path::new(&expand_path(&path)))
}

/// Saves atomically (temp file + rename, keeping the file's permissions). With
/// `expected_mtime_ms`, refuses when the file changed on disk since it was loaded.
#[tauri::command]
pub fn write_text_file(path: String, text: String, expected_mtime_ms: Option<f64>) -> Result<f64, String> {
    let p = PathBuf::from(expand_path(&path));
    if let (Some(expected), Ok(now)) = (expected_mtime_ms, mtime_ms(&p)) {
        if (now - expected).abs() > 1.0 {
            return Err("CHANGED_ON_DISK".into());
        }
    }
    let dir = p.parent().ok_or("no parent folder")?;
    let name = p.file_name().ok_or("no file name")?.to_string_lossy();
    let tmp = dir.join(format!(".{name}.aurelia-save"));
    fs::write(&tmp, text.as_bytes()).map_err(|e| e.to_string())?;
    if let Ok(meta) = fs::metadata(&p) {
        let _ = fs::set_permissions(&tmp, meta.permissions());
    }
    fs::rename(&tmp, &p).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    mtime_ms(&p)
}

#[derive(Serialize, Debug, PartialEq)]
pub struct SearchMatch {
    path: String,
    line: u32,
    /// 1-based character column of the first match on the line, and its length in characters.
    col: u32,
    len: u32,
    text: String,
}

/// One `rg --json` line's matches.
fn parse_rg(line: &str) -> Vec<SearchMatch> {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return vec![] };
    if v["type"] != "match" {
        return vec![];
    }
    let d = &v["data"];
    let (Some(path), Some(n)) = (d["path"]["text"].as_str(), d["line_number"].as_u64()) else { return vec![] };
    let text = d["lines"]["text"].as_str().unwrap_or("").trim_end().to_string();
    // rg reports byte offsets; the editor wants characters.
    let chars = |b: u64| text.get(..b as usize).map(|p| p.chars().count()).unwrap_or(0);
    let m = &d["submatches"][0];
    let (col, len) = match (m["start"].as_u64(), m["end"].as_u64()) {
        (Some(s), Some(e)) => (chars(s) + 1, chars(e).saturating_sub(chars(s))),
        _ => (1, 0),
    };
    vec![SearchMatch { path: path.to_string(), line: n as u32, col: col as u32, len: len as u32, text: text.chars().take(300).collect() }]
}

#[tauri::command]
pub async fn search_project(root: String, query: String, regex: bool, case_sensitive: bool) -> Result<Vec<SearchMatch>, String> {
    if query.is_empty() {
        return Ok(vec![]);
    }
    let rg = which::locate("rg").ok_or("ripgrep (rg) isn't installed: brew install ripgrep")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(rg);
        cmd.args(["--json", "--max-columns", "400", "--max-filesize", "2M", "--max-count", "100"])
            .arg(if case_sensitive { "--case-sensitive" } else { "--smart-case" });
        if !regex {
            cmd.arg("--fixed-strings");
        }
        let root = expand_path(&root);
        cmd.arg("--").arg(&query).arg(&root).stdout(Stdio::piped()).stderr(Stdio::null());
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        let mut out = vec![];
        for line in BufReader::new(child.stdout.take().ok_or("no output")?).lines() {
            let Ok(line) = line else { break };
            out.extend(parse_rg(&line));
            if out.len() >= MAX_MATCHES {
                let _ = child.kill();
                break;
            }
        }
        let _ = child.wait();
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Problem {
    path: String,
    line: u32,
    col: u32,
    severity: String,
    message: String,
    /// "tsc" | "cargo"
    source: &'static str,
}

/// `file(line,col): error TS2339: message`
fn parse_tsc(out: &str, root: &Path) -> Vec<Problem> {
    out.lines()
        .filter_map(|l| {
            let (loc, rest) = l.split_once("): ")?;
            let (file, pos) = loc.rsplit_once('(')?;
            let (line, col) = pos.split_once(',')?;
            let (severity, msg) = rest.split_once(' ')?;
            if severity != "error" && severity != "warning" {
                return None;
            }
            Some(Problem {
                path: root.join(file).to_string_lossy().into_owned(),
                line: line.parse().ok()?,
                col: col.parse().ok()?,
                severity: severity.into(),
                message: msg.trim().to_string(),
                source: "tsc",
            })
        })
        .collect()
}

/// `src/x.rs:12:5: error[E0425]: message` (cargo --message-format short)
fn parse_cargo(out: &str, crate_dir: &Path) -> Vec<Problem> {
    out.lines()
        .filter_map(|l| {
            let mut parts = l.splitn(4, ':');
            let (file, line, col, rest) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
            let rest = rest.trim_start();
            let severity = if rest.starts_with("error") { "error" } else if rest.starts_with("warning") { "warning" } else { return None };
            let message = rest.split_once(": ").map(|(_, m)| m).unwrap_or(rest).trim().to_string();
            Some(Problem {
                path: crate_dir.join(file).to_string_lossy().into_owned(),
                line: line.trim().parse().ok()?,
                col: col.trim().parse().ok()?,
                severity: severity.into(),
                message,
                source: "cargo",
            })
        })
        .collect()
}

#[derive(Serialize)]
pub struct CheckResult {
    problems: Vec<Problem>,
    /// Which checkers ran, e.g. ["tsc", "cargo check (src-tauri)"].
    ran: Vec<String>,
}

fn output(cmd: &mut Command) -> String {
    cmd.stdin(Stdio::null())
        .output()
        .map(|o| format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)))
        .unwrap_or_default()
}

/// Runs the project's own type checkers and lists what they report.
#[tauri::command]
pub async fn check_project(root: String) -> Result<CheckResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(expand_path(&root));
        let mut problems = vec![];
        let mut ran = vec![];
        let tsc = root.join("node_modules/.bin/tsc");
        if root.join("tsconfig.json").is_file() && tsc.is_file() {
            problems.extend(parse_tsc(&output(Command::new(&tsc).args(["--noEmit", "--pretty", "false"]).current_dir(&root)), &root));
            ran.push("tsc".to_string());
        }
        for dir in [root.clone(), root.join("src-tauri")] {
            if !dir.join("Cargo.toml").is_file() {
                continue;
            }
            let Some(cargo) = which::locate("cargo") else { break };
            problems.extend(parse_cargo(&output(Command::new(cargo).args(["check", "--message-format", "short"]).current_dir(&dir)), &dir));
            let label = dir.strip_prefix(&root).ok().filter(|p| !p.as_os_str().is_empty()).map(|p| format!("cargo check ({})", p.display()));
            ran.push(label.unwrap_or_else(|| "cargo check".into()));
        }
        if ran.is_empty() {
            return Err("No checker found here (looked for tsconfig.json with tsc installed, and Cargo.toml).".into());
        }
        problems.sort_by(|a, b| (a.severity != "error").cmp(&(b.severity != "error")).then(a.path.cmp(&b.path)).then(a.line.cmp(&b.line)));
        problems.dedup();
        problems.truncate(MAX_PROBLEMS);
        Ok(CheckResult { problems, ran })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Debug, PartialEq)]
pub struct ThreadItem {
    /// "user" | "assistant" | "tool"
    role: &'static str,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    error: bool,
}

fn tool_line(name: &str, input: &Value) -> String {
    let arg = ["command", "file_path", "path", "pattern", "url", "description", "prompt"]
        .iter()
        .find_map(|k| input.get(*k).and_then(Value::as_str))
        .unwrap_or("");
    let first: String = arg.lines().next().unwrap_or("").trim().chars().take(160).collect();
    if first.is_empty() { name.to_string() } else { first }
}

/// Folds transcript lines into a readable thread: what was asked, what Claude said, and
/// each tool call as one line. Subagent sidechains, thinking and meta lines are left out.
fn thread_from(lines: impl Iterator<Item = String>) -> Vec<ThreadItem> {
    let mut items: Vec<ThreadItem> = vec![];
    let mut last_msg: Option<String> = None;
    let mut tool_index: std::collections::HashMap<String, usize> = Default::default();
    for line in lines {
        let Ok(e) = serde_json::from_str::<Value>(&line) else { continue };
        if e["isSidechain"] == true || e["isMeta"] == true {
            continue;
        }
        let kind = e["type"].as_str().unwrap_or("");
        let content = &e["message"]["content"];
        match kind {
            "user" => {
                if let Some(s) = content.as_str() {
                    let s = s.trim();
                    // Slash commands and their output are bookkeeping, not conversation.
                    if !s.is_empty() && !s.starts_with("<command-") && !s.starts_with("<local-command") {
                        items.push(ThreadItem { role: "user", text: s.to_string(), tool: None, error: false });
                    }
                    last_msg = None;
                } else if let Some(blocks) = content.as_array() {
                    for b in blocks {
                        match b["type"].as_str() {
                            Some("text") => {
                                let t = b["text"].as_str().unwrap_or("").trim();
                                if !t.is_empty() && !t.starts_with("<system-reminder>") {
                                    items.push(ThreadItem { role: "user", text: t.to_string(), tool: None, error: false });
                                }
                            }
                            Some("tool_result") if b["is_error"] == true => {
                                if let Some(&i) = b["tool_use_id"].as_str().and_then(|id| tool_index.get(id)) {
                                    items[i].error = true;
                                }
                            }
                            _ => {}
                        }
                    }
                    last_msg = None;
                }
            }
            "assistant" => {
                let msg_id = e["message"]["id"].as_str().map(String::from);
                for b in content.as_array().into_iter().flatten() {
                    match b["type"].as_str() {
                        Some("text") => {
                            let t = b["text"].as_str().unwrap_or("").trim();
                            if t.is_empty() {
                                continue;
                            }
                            // Blocks of one message arrive as separate lines; keep them together.
                            match items.last_mut() {
                                Some(prev) if prev.role == "assistant" && last_msg.is_some() && last_msg == msg_id => {
                                    prev.text.push_str("\n\n");
                                    prev.text.push_str(t);
                                }
                                _ => items.push(ThreadItem { role: "assistant", text: t.to_string(), tool: None, error: false }),
                            }
                        }
                        Some("tool_use") => {
                            let name = b["name"].as_str().unwrap_or("tool").to_string();
                            if let Some(id) = b["id"].as_str() {
                                tool_index.insert(id.to_string(), items.len());
                            }
                            items.push(ThreadItem { role: "tool", text: tool_line(&name, &b["input"]), tool: Some(name), error: false });
                        }
                        _ => {}
                    }
                }
                last_msg = msg_id;
            }
            _ => {}
        }
    }
    items
}

#[tauri::command]
pub fn transcript_thread(path: String, max_items: usize) -> Result<Vec<ThreadItem>, String> {
    let f = fs::File::open(expand_path(&path)).map_err(|e| e.to_string())?;
    let items = thread_from(BufReader::new(f).lines().map_while(Result::ok));
    let skip = items.len().saturating_sub(max_items.max(1));
    Ok(items.into_iter().skip(skip).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_and_saves_with_conflict_detection() {
        let dir = std::env::temp_dir().join(format!("aurelia-ide-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.txt");
        fs::write(&p, "one").unwrap();
        let path = p.to_string_lossy().into_owned();
        let f = read_text_file(path.clone()).unwrap();
        assert_eq!(f.text, "one");
        let m2 = write_text_file(path.clone(), "two".into(), Some(f.mtime_ms)).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "two");
        assert!(!dir.join(".a.txt.aurelia-save").exists(), "temp file cleaned up by the rename");
        // Someone else writes; a save based on the old load is refused.
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&p, "theirs").unwrap();
        assert_eq!(write_text_file(path.clone(), "mine".into(), Some(m2)).unwrap_err(), "CHANGED_ON_DISK");
        assert_eq!(fs::read_to_string(&p).unwrap(), "theirs");
        // Without an expectation (a forced save) it overwrites.
        write_text_file(path.clone(), "mine".into(), None).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "mine");
        fs::write(dir.join("b.bin"), [0u8, 1, 2]).unwrap();
        assert_eq!(read_text_file(dir.join("b.bin").to_string_lossy().into_owned()).unwrap_err(), "Binary file.");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_ripgrep_matches() {
        let line = r#"{"type":"match","data":{"path":{"text":"/r/src/a.ts"},"lines":{"text":"  const héllo = foo();\n"},"line_number":12,"absolute_offset":0,"submatches":[{"match":{"text":"foo"},"start":17,"end":20}]}}"#;
        assert_eq!(parse_rg(line), [SearchMatch { path: "/r/src/a.ts".into(), line: 12, col: 17, len: 3, text: "  const héllo = foo();".into() }]);
        assert!(parse_rg(r#"{"type":"begin","data":{}}"#).is_empty());
    }

    #[test]
    fn parses_checker_output() {
        let tsc = "src/lib/a.ts(19,103): error TS2339: Property 'x' does not exist.\nsome noise\nsrc/b.tsx(1,2): warning TS6133: unused.";
        let p = parse_tsc(tsc, Path::new("/r"));
        assert_eq!(p.len(), 2);
        assert_eq!((p[0].path.as_str(), p[0].line, p[0].col, p[0].severity.as_str()), ("/r/src/lib/a.ts", 19, 103, "error"));
        assert_eq!(p[0].message, "TS2339: Property 'x' does not exist.");
        let cargo = "src/x.rs:12:5: error[E0425]: cannot find value `y`\nsrc/y.rs:3:1: warning: unused import\nerror: could not compile";
        let c = parse_cargo(cargo, Path::new("/r/src-tauri"));
        assert_eq!(c.len(), 2);
        assert_eq!((c[0].path.as_str(), c[0].line, c[0].col, c[0].message.as_str()), ("/r/src-tauri/src/x.rs", 12, 5, "cannot find value `y`"));
        assert_eq!(c[1].severity, "warning");
    }

    /// Real data: `cargo test ide_real -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn ide_real() {
        let home = std::env::var("HOME").unwrap();
        let dir = format!("{home}/.claude-a/projects/-Users-Boon-Downloads-AureliaSpace");
        let newest = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "jsonl")).max_by_key(|p| fs::metadata(p).and_then(|m| m.modified()).ok()).unwrap();
        let t = transcript_thread(newest.to_string_lossy().into_owned(), 10_000).unwrap();
        let count = |r: &str| t.iter().filter(|i| i.role == r).count();
        println!("thread: {} items ({} user, {} assistant, {} tool, {} tool errors)", t.len(), count("user"), count("assistant"), count("tool"), t.iter().filter(|i| i.error).count());
        for i in t.iter().filter(|i| i.role == "user").take(3) {
            println!("  user: {}", i.text.chars().take(90).collect::<String>().replace('\n', " "));
        }
        let m = tauri::async_runtime::block_on(search_project("..".into(), "startHandoffAdvisor".into(), false, false)).unwrap();
        println!("search: {:?}", m.iter().map(|m| format!("{}:{}:{}", m.path, m.line, m.col)).collect::<Vec<_>>());
        assert!(m.iter().any(|m| m.path.ends_with("main.tsx")));
    }

    #[test]
    fn folds_a_transcript_into_a_thread() {
        let lines = [
            r#"{"type":"user","message":{"role":"user","content":"fix the bug"}}"#,
            r#"{"type":"user","isMeta":true,"message":{"content":"meta"}}"#,
            r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"thinking","thinking":"hmm"}]}}"#,
            r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"Looking."}]}}"#,
            r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"Found it."}]}}"#,
            r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"cargo test\nmore"}}]}}"#,
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","is_error":true,"content":"boom"}]}}"#,
            r#"{"type":"assistant","isSidechain":true,"message":{"id":"s","content":[{"type":"text","text":"subagent"}]}}"#,
            r#"{"type":"user","message":{"content":"<command-name>/clear</command-name>"}}"#,
            r#"{"type":"assistant","message":{"id":"m2","content":[{"type":"text","text":"Fixed."}]}}"#,
            "garbage",
        ];
        let t = thread_from(lines.iter().map(|s| s.to_string()));
        let summary: Vec<(&str, &str, bool)> = t.iter().map(|i| (i.role, i.text.as_str(), i.error)).collect();
        assert_eq!(
            summary,
            [("user", "fix the bug", false), ("assistant", "Looking.\n\nFound it.", false), ("tool", "cargo test", true), ("assistant", "Fixed.", false)]
        );
        assert_eq!(t[2].tool.as_deref(), Some("Bash"));
    }
}
