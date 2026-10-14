//! Post-run reviewer: grades the uncommitted changes in a repo against scorers, using a
//! read-only DeepSeek agent through OpenCode (subagents.rs), so a review never spends
//! Claude limits. Scorers are markdown rubrics in `<repo>/.aurelia/scorers/*.md`, one
//! per file; without any, a built-in set covers correctness, regressions, security,
//! tests and simplicity.

use crate::{git, subagents};
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// More than enough diff for a review; DeepSeek reads the rest of the repo itself.
const MAX_REVIEW_DIFF: usize = 300_000;
const MAX_SCORER: usize = 8_000;

const DEFAULT_SCORERS: &str = "## Correctness\nDoes the change do what it sets out to without breaking existing behaviour? \
Look for wrong conditions, off-by-one errors, unhandled errors and races.\n\n\
## Regressions\nAre callers, configs or tests affected by changed signatures, defaults or behaviour?\n\n\
## Security\nSecrets in code, shell/SQL/path injection, unsafe file operations, widened permissions.\n\n\
## Tests\nAre risky changes covered, and were existing tests updated where behaviour changed?\n\n\
## Simplicity\nDead code, duplicated logic, needless complexity.";

const TASK: &str = "Review the uncommitted change in the attached diff (`git diff HEAD` plus new files). Read files in \
the repository when you need context. Judge the change against each scorer in Context. For each scorer write one line \
`<scorer>: PASS` or `<scorer>: FAIL - <reason>`, followed by the specific problems with file:line. Report only real \
problems you can point to, no style nits unless a scorer asks for them. End with exactly one line: `VERDICT: ship`, \
`VERDICT: fix` or `VERDICT: block`.";

#[derive(Debug, Serialize)]
pub struct ReviewResult {
    pub text: String,
    /// "ship" | "fix" | "block", when the reviewer gave one.
    pub verdict: Option<String>,
    pub scorers: Vec<String>,
    pub model: String,
    pub seconds: f64,
    pub failed: bool,
}

/// The scorers for a repo: (names, text for the agent).
fn scorers(root: &Path) -> (Vec<String>, String) {
    let mut files: Vec<_> = fs::read_dir(root.join(".aurelia/scorers"))
        .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "md")).collect())
        .unwrap_or_default();
    files.sort();
    let mut names = vec![];
    let mut text = String::new();
    for path in files {
        let Ok(body) = fs::read_to_string(&path) else { continue };
        let name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let body: String = body.chars().take(MAX_SCORER).collect();
        text.push_str(&format!("## {name}\n{}\n\n", body.trim()));
        names.push(name);
    }
    if names.is_empty() {
        let defaults = DEFAULT_SCORERS.lines().filter_map(|l| l.strip_prefix("## ")).map(String::from).collect();
        return (defaults, DEFAULT_SCORERS.to_string());
    }
    (names, text.trim_end().to_string())
}

/// The last `VERDICT:` line's word.
fn verdict(report: &str) -> Option<String> {
    report.lines().rev().find_map(|l| {
        let rest = l.trim().trim_matches(|c| c == '*' || c == '`').trim().strip_prefix("VERDICT:")?;
        let word = rest.trim().trim_matches(|c: char| !c.is_ascii_alphabetic()).to_lowercase();
        ["ship", "fix", "block"].contains(&word.as_str()).then_some(word)
    })
}

fn temp_diff(diff: &str) -> Result<std::path::PathBuf, String> {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let path = std::env::temp_dir().join(format!("aurelia-review-{}-{nanos}.diff", std::process::id()));
    let mut cut = diff.len().min(MAX_REVIEW_DIFF);
    while !diff.is_char_boundary(cut) {
        cut -= 1;
    }
    fs::write(&path, &diff[..cut]).map_err(|e| e.to_string())?;
    Ok(path)
}

#[tauri::command]
pub async fn review_changes(cwd: String) -> Result<ReviewResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let d = git::git_diff(cwd)?;
        if d.diff.trim().is_empty() {
            return Err("No uncommitted changes to review.".into());
        }
        let root = Path::new(&d.root);
        let (names, rubric) = scorers(root);
        let diff_path = temp_diff(&d.diff)?;
        let started = Instant::now();
        let mut context = format!("Scorers:\n\n{rubric}");
        if d.truncated || d.diff.len() > MAX_REVIEW_DIFF {
            context.push_str("\n\nThe diff was cut short; read the changed files for the rest.");
        }
        let run = subagents::run_read_only(TASK.into(), Some(context), vec![diff_path.to_string_lossy().into_owned()], &d.root);
        let _ = fs::remove_file(&diff_path);
        let run = run?;
        Ok(ReviewResult {
            verdict: verdict(&run.report),
            text: run.rendered,
            scorers: names,
            model: run.model,
            seconds: started.elapsed().as_secs_f64(),
            failed: run.failed,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_last_verdict() {
        assert_eq!(verdict("a: PASS\nVERDICT: ship").as_deref(), Some("ship"));
        assert_eq!(verdict("VERDICT: fix\nmore\n**VERDICT: Block**").as_deref(), Some("block"));
        assert_eq!(verdict("`VERDICT: fix.`").as_deref(), Some("fix"));
        assert_eq!(verdict("VERDICT: maybe"), None);
        assert_eq!(verdict("no verdict here"), None);
    }

    #[test]
    fn uses_repo_scorers_or_the_defaults() {
        let dir = std::env::temp_dir().join(format!("aurelia-review-scorers-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let (names, text) = scorers(&dir);
        assert_eq!(names, ["Correctness", "Regressions", "Security", "Tests", "Simplicity"]);
        assert!(text.contains("## Security"));

        fs::create_dir_all(dir.join(".aurelia/scorers")).unwrap();
        fs::write(dir.join(".aurelia/scorers/b-perf.md"), "No allocations in the render loop.\n").unwrap();
        fs::write(dir.join(".aurelia/scorers/a-api.md"), "Public functions keep their signatures.").unwrap();
        fs::write(dir.join(".aurelia/scorers/notes.txt"), "ignored").unwrap();
        let (names, text) = scorers(&dir);
        assert_eq!(names, ["a-api", "b-perf"]);
        assert_eq!(text, "## a-api\nPublic functions keep their signatures.\n\n## b-perf\nNo allocations in the render loop.");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Live: a real DeepSeek review of a planted bug. `cargo test review_live -- --ignored`
    #[test]
    #[ignore]
    fn review_live() {
        let dir = std::env::temp_dir().join(format!("aurelia-review-live-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| assert!(std::process::Command::new("git").args(args).current_dir(&dir).output().unwrap().status.success());
        git(&["init", "-q"]);
        fs::write(dir.join("auth.py"), "def can_delete(user, doc):\n    return user.id == doc.owner_id\n").unwrap();
        git(&["add", "."]);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
        fs::write(dir.join("auth.py"), "def can_delete(user, doc):\n    return user.id == doc.owner_id or True\n").unwrap();
        let r = tauri::async_runtime::block_on(review_changes(dir.to_string_lossy().into_owned())).unwrap();
        println!("{} in {:.1}s\n{}", r.verdict.as_deref().unwrap_or("-"), r.seconds, r.text);
        assert!(matches!(r.verdict.as_deref(), Some("fix") | Some("block")), "the planted bug should not ship");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn diff_is_capped_on_a_char_boundary() {
        let big = "é".repeat(MAX_REVIEW_DIFF);
        let p = temp_diff(&big).unwrap();
        let written = fs::read_to_string(&p).unwrap();
        assert!(written.len() <= MAX_REVIEW_DIFF && written.chars().all(|c| c == 'é'));
        let _ = fs::remove_file(p);
    }
}
