//! Auto effort: picks the reasoning effort for the next prompt a Claude pane gets from
//! the composer. Rules settle the clear cases instantly; the rest go to a judge, Haiku
//! 5.5 run headless on the pane's own account (about a second). The pick is clamped to
//! the floor and ceiling from Settings. The frontend applies it (lib/effort.ts) through
//! the `/effort` picker's session-only choice, so the user's saved default never moves.

use crate::{config, which};
use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const LEVELS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];
const JUDGE_MODEL: &str = "claude-haiku-5-5";
const JUDGE_TIMEOUT: Duration = Duration::from_secs(10);
/// Enough of a long prompt to judge it; the rest rarely changes the answer.
const JUDGE_CHARS: usize = 4000;

const RUBRIC: &str = "You pick the reasoning effort a coding agent should use for the task it is about to get. \
Reply with exactly one word: low, medium, high or xhigh.\n\
low: lookups, quick factual questions, one-line or mechanical edits, formatting, renames, git chores.\n\
medium: ordinary feature work or edits across a few files with a clear spec; explanations.\n\
high: debugging, unclear failures, multi-file refactors, design decisions, tricky logic, code review.\n\
xhigh: hard concurrency, security or architecture problems, or work where a mistake is very costly.\n\
Prefer the lowest level that will do the job well.";

#[derive(Debug, Serialize, PartialEq)]
pub struct EffortPick {
    /// None = leave the effort as it is (e.g. "continue" mid-task).
    pub level: Option<String>,
    /// "rules" | "judge" | "keep"
    pub source: &'static str,
    pub why: String,
    /// A rules-only preview of a prompt the judge will decide on send.
    #[serde(default)]
    pub pending: bool,
}

fn rank(level: &str) -> Option<usize> {
    LEVELS.iter().position(|l| *l == level)
}

/// Replies that carry on with the current task: switching effort mid-task would only
/// cost a cache write.
const CONTINUE: &[&str] = &[
    "y", "yes", "yep", "yeah", "n", "no", "nope", "ok", "okay", "k", "sure", "continue", "go", "go on", "go ahead",
    "proceed", "do it", "keep going", "carry on", "sounds good", "lgtm", "looks good", "thanks", "thank you", "ty",
    "next", "done", "1", "2", "3", "4", "a", "b", "c",
];

const HIGH: &[&str] = &[
    "debug", "bug", "crash", "fails", "failing", "failure", "broken", "doesn't work", "does not work", "not working",
    "still doesn't", "regression", "race condition", "deadlock", "memory leak", "root cause", "stack trace",
    "traceback", "panic", "segfault", "flaky", "architecture", "redesign", "refactor", "migrate", "migration",
    "security", "vulnerab", "performance", "optimize", "optimise", "concurren", "investigate", "why does", "why is",
    "why doesn't", "review", "design a", "plan the", "plan for",
];

const LOW: &[&str] = &[
    "typo", "rename", "reformat", "format the", "lint", "bump", "commit", "push", "what is", "what's", "where is",
    "which file", "show me", "list the", "print", "run the tests", "run tests", "add a comment", "spelling",
    "capitalize", "remove the unused", "delete the unused", "update the readme", "changelog",
];

fn has_any(text: &str, words: &[&str]) -> usize {
    words.iter().filter(|w| text.contains(*w)).count()
}

/// Pasted errors and code read as a problem to dig into.
fn looks_like_error_dump(prompt: &str) -> bool {
    prompt.contains("```")
        || prompt.lines().filter(|l| {
            let l = l.trim_start();
            l.starts_with("at ") || l.starts_with("error") || l.starts_with("Error") || l.starts_with("thread '") || l.contains("Exception")
        }).count() >= 2
}

/// The rules' pick and whether it is sure enough to skip the judge.
pub fn rules(prompt: &str) -> (EffortPick, bool) {
    let p = prompt.trim().to_lowercase();
    let words = p.split_whitespace().count();
    let pick = |level: &str, why: &str| EffortPick { level: Some(level.into()), source: "rules", why: why.into(), pending: false };
    // The user's own words win.
    if p.contains("ultrathink") {
        return (pick("max", "you asked for ultrathink"), true);
    }
    if p.contains("think harder") || p.contains("think very hard") || p.contains("megathink") {
        return (pick("xhigh", "you asked it to think harder"), true);
    }
    if p.contains("think hard") {
        return (pick("high", "you asked it to think hard"), true);
    }
    let bare = p.trim_end_matches(['.', '!', '?']).trim();
    if words <= 4 && CONTINUE.contains(&bare) {
        return (EffortPick { level: None, source: "keep", why: "carrying on with the current task".into(), pending: false }, true);
    }
    let high = has_any(&p, HIGH) + usize::from(looks_like_error_dump(prompt));
    if high >= 2 && words > 150 {
        return (pick("xhigh", "a long, hard problem"), true);
    }
    if high >= 1 {
        let why = if looks_like_error_dump(prompt) { "pasted errors or code to dig into" } else { "debugging, design or a refactor" };
        return (pick("high", why), true);
    }
    if words > 200 {
        return (pick("high", "a long, detailed request"), false);
    }
    if has_any(&p, LOW) >= 1 && words <= 40 {
        return (pick("low", "a quick lookup or mechanical change"), true);
    }
    if words <= 8 && p.ends_with('?') {
        return (pick("low", "a short question"), false);
    }
    (pick("medium", "an ordinary task"), false)
}

/// Floor and ceiling from Settings; a "keep" stays a keep.
pub fn clamp(mut pick: EffortPick, floor: &str, ceiling: &str) -> EffortPick {
    let Some(level) = pick.level.as_deref() else { return pick };
    let (lo, hi) = (rank(floor).unwrap_or(0), rank(ceiling).unwrap_or(LEVELS.len() - 1).max(rank(floor).unwrap_or(0)));
    let r = rank(level).unwrap_or(1).clamp(lo, hi);
    if LEVELS[r] != level {
        pick.why = format!("{} (capped at {})", pick.why, if r == hi { ceiling } else { floor });
        pick.level = Some(LEVELS[r].into());
    }
    pick
}

/// The judge's one-word answer, from `claude -p --output-format json`.
fn parse_judge(stdout: &str) -> Option<String> {
    let v: Value = serde_json::from_str(stdout.trim()).ok()?;
    if v["is_error"].as_bool() == Some(true) {
        return None;
    }
    let text = v["result"].as_str()?.trim().to_lowercase();
    // Longest names first, so "xhigh" isn't read as "high".
    ["xhigh", "medium", "high", "low"].into_iter().find(|l| text.split(|c: char| !c.is_ascii_alphanumeric()).any(|w| w == *l)).map(String::from)
}

fn judge(account: Option<&str>, prompt: &str) -> Result<String, String> {
    let claude = which::locate("claude").ok_or("claude isn't installed")?;
    let task: String = prompt.chars().take(JUDGE_CHARS).collect();
    let mut cmd = Command::new(claude);
    cmd.args(["-p", "--model", JUDGE_MODEL, "--output-format", "json", "--setting-sources", "", "--strict-mcp-config", "--tools", ""])
        .args(["--disable-slash-commands", "--no-session-persistence", "--system-prompt", RUBRIC])
        .arg(format!("Task:\n{task}"))
        .current_dir(std::env::temp_dir())
        .env_remove("CLAUDECODE")
        .env_remove("CLAUDE_CODE_ENTRYPOINT")
        .env_remove("CLAUDE_CONFIG_DIR")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(name) = account {
        let cfg = config::load();
        let acct = cfg.accounts.iter().find(|a| a.name == name).ok_or_else(|| format!("unknown account '{name}'"))?;
        if !acct.is_default() {
            cmd.env("CLAUDE_CONFIG_DIR", acct.resolved_dir());
        }
    }
    let mut child = cmd.spawn().map_err(|e| format!("could not start the judge: {e}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() > JUDGE_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("the judge took too long".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(e) => return Err(e.to_string()),
        }
    }
    let mut out = String::new();
    child.stdout.take().ok_or("judge has no output")?.read_to_string(&mut out).map_err(|e| e.to_string())?;
    parse_judge(&out).ok_or_else(|| "the judge gave no level".into())
}

/// Effort for `prompt` on `account`'s pane. `use_judge` false = rules only (the
/// composer's live preview, which must not spend anything).
#[tauri::command]
pub async fn choose_effort(account: Option<String>, prompt: String, use_judge: bool) -> EffortPick {
    let cfg = config::load().effort;
    let (pick, sure) = rules(&prompt);
    let pick = if sure || !cfg.judge {
        pick
    } else if !use_judge {
        EffortPick { pending: true, ..pick }
    } else {
        let fallback = pick;
        tauri::async_runtime::spawn_blocking(move || match judge(account.as_deref(), &prompt) {
            Ok(level) => EffortPick { level: Some(level), source: "judge", why: "Haiku's call".into(), pending: false },
            Err(e) => EffortPick { why: format!("{} ({e})", fallback.why), ..fallback },
        })
        .await
        .unwrap_or_else(|e| EffortPick { level: Some("medium".into()), source: "rules", why: e.to_string(), pending: false })
    };
    clamp(pick, &cfg.floor, &cfg.ceiling)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn level(prompt: &str) -> Option<String> {
        rules(prompt).0.level
    }

    #[test]
    fn explicit_requests_win() {
        assert_eq!(level("ultrathink about the cache layout"), Some("max".into()));
        assert_eq!(level("Think harder about this rename"), Some("xhigh".into()));
        assert_eq!(level("think hard: what's in config.rs?"), Some("high".into()));
    }

    #[test]
    fn continuing_keeps_the_current_effort() {
        for p in ["yes", "Continue.", "go ahead", "ok!", "2", "sounds good"] {
            let (pick, sure) = rules(p);
            assert_eq!((pick.level, pick.source, sure), (None, "keep", true), "{p}");
        }
        assert!(rules("yes, and also refactor the store").0.level.is_some());
    }

    // A small labelled set; every one the rules call "sure" must be right.
    const LABELLED: &[(&str, &str)] = &[
        ("fix the typo in the README heading", "low"),
        ("rename `fooBar` to `foo_bar` in utils.ts", "low"),
        ("what's the default port in vite.config.ts?", "low"),
        ("commit and push", "low"),
        ("run the tests", "low"),
        ("bump the version to 0.2.0", "low"),
        ("where is the pty reader thread started?", "low"),
        ("the app crashes when I close the last tab, find out why", "high"),
        ("tests are failing on main since yesterday's merge", "high"),
        ("refactor the layout store so panes and tabs live in one map", "high"),
        ("review my last commit for bugs", "high"),
        ("it still doesn't work after your fix", "high"),
        ("why does the usage meter show 0% after a restart?", "high"),
        ("TypeError: cannot read properties of undefined\n  at render (App.tsx:12)\n  at commit (react.js:99)", "high"),
        ("migrate the config from JSON to TOML without losing user edits", "high"),
        ("we have a race condition between the watcher and save_config", "high"),
    ];

    #[test]
    fn sure_rules_match_the_labelled_set() {
        for (prompt, want) in LABELLED {
            let (pick, sure) = rules(prompt);
            assert!(sure, "rules should be sure about {prompt:?}");
            assert_eq!(pick.level.as_deref(), Some(*want), "{prompt:?}: {}", pick.why);
        }
    }

    #[test]
    fn ordinary_work_goes_to_the_judge() {
        for p in ["add a settings toggle for the HUD opacity", "write a function that groups panes by account", "make the sidebar collapsible"] {
            let (pick, sure) = rules(p);
            assert_eq!((pick.level.as_deref(), sure), (Some("medium"), false), "{p}");
        }
    }

    #[test]
    fn clamps_to_floor_and_ceiling() {
        let p = |l: &str| EffortPick { level: Some(l.into()), source: "rules", why: "x".into(), pending: false };
        assert_eq!(clamp(p("max"), "low", "high").level.as_deref(), Some("high"));
        assert!(clamp(p("max"), "low", "high").why.contains("capped at high"));
        assert_eq!(clamp(p("low"), "medium", "high").level.as_deref(), Some("medium"));
        assert_eq!(clamp(p("medium"), "low", "high").level.as_deref(), Some("medium"));
        // A ceiling below the floor can't push the pick under the floor.
        assert_eq!(clamp(p("low"), "high", "low").level.as_deref(), Some("high"));
        let keep = EffortPick { level: None, source: "keep", why: "k".into(), pending: false };
        assert_eq!(clamp(keep, "high", "high").level, None);
    }

    #[test]
    fn reads_the_judges_answer() {
        assert_eq!(parse_judge(r#"{"type":"result","is_error":false,"result":"high"}"#).as_deref(), Some("high"));
        assert_eq!(parse_judge(r#"{"is_error":false,"result":"XHigh."}"#).as_deref(), Some("xhigh"));
        assert_eq!(parse_judge(r#"{"is_error":false,"result":"low\n"}"#).as_deref(), Some("low"));
        assert_eq!(parse_judge(r#"{"is_error":true,"result":"high"}"#), None);
        assert_eq!(parse_judge(r#"{"is_error":false,"result":"I think it's hard"}"#), None);
        assert_eq!(parse_judge("not json"), None);
    }
}
