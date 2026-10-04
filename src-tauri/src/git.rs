//! Git helpers for pane headers (branch / worktree), per-agent worktrees, and the
//! diff review panel. Branch info is read straight from `.git` so polling it for
//! every pane never forks a process.

use crate::config::expand_path;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub root: String,
    /// Branch name, or a short commit hash when HEAD is detached.
    pub branch: String,
    pub detached: bool,
    /// True when `root` is a linked worktree rather than the main checkout.
    pub worktree: bool,
}

/// Nearest ancestor with a `.git` entry, plus the resolved git dir.
fn find_repo(start: &Path) -> Option<(PathBuf, PathBuf)> {
    let mut dir = start;
    loop {
        let dotgit = dir.join(".git");
        if dotgit.is_dir() {
            return Some((dir.to_path_buf(), dotgit));
        }
        if dotgit.is_file() {
            let text = fs::read_to_string(&dotgit).ok()?;
            let target = text.trim().strip_prefix("gitdir:")?.trim();
            let gitdir = if Path::new(target).is_absolute() { PathBuf::from(target) } else { dir.join(target) };
            return Some((dir.to_path_buf(), gitdir));
        }
        dir = dir.parent()?;
    }
}

#[tauri::command]
pub fn git_info(cwd: String) -> Option<GitInfo> {
    let (root, gitdir) = find_repo(Path::new(&expand_path(&cwd)))?;
    let head = fs::read_to_string(gitdir.join("HEAD")).ok()?;
    let head = head.trim();
    let (branch, detached) = match head.strip_prefix("ref: ") {
        Some(r) => (r.strip_prefix("refs/heads/").unwrap_or(r).to_string(), false),
        None => (head.chars().take(7).collect(), true),
    };
    let worktree = gitdir.parent().and_then(|p| p.file_name()).is_some_and(|n| n == "worktrees");
    Some(GitInfo { root: root.to_string_lossy().into_owned(), branch, detached, worktree })
}

fn git(dir: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git").arg("-C").arg(dir).args(args).output().map_err(|e| format!("git: {e}"))
}

fn git_ok(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = git(dir, args)?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
        if out.len() >= 32 {
            break;
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() { "agent".into() } else { out }
}

/// Creates a new worktree on branch `aurelia/<label>-<n>` from the current HEAD, in
/// `<repo parent>/<repo>.worktrees/`, and returns its path.
#[tauri::command]
pub fn create_worktree(cwd: String, label: String) -> Result<String, String> {
    // Canonical, so it lines up with git's (symlink-resolved) toplevel below.
    let start = fs::canonicalize(expand_path(&cwd)).map_err(|e| e.to_string())?;
    let top = PathBuf::from(git_ok(&start, &["rev-parse", "--show-toplevel"]).map_err(|_| "not inside a git repository".to_string())?);
    let repo = top.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "repo".into());
    let base_dir = top.parent().unwrap_or(&top).join(format!("{repo}.worktrees"));
    fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;

    let base = slug(&label);
    let (name, path) = (1..1000)
        .map(|n| if n == 1 { base.clone() } else { format!("{base}-{n}") })
        .map(|name| (name.clone(), base_dir.join(&name)))
        .find(|(name, path)| {
            !path.exists() && git(&top, &["show-ref", "--verify", "--quiet", &format!("refs/heads/aurelia/{name}")]).map(|o| !o.status.success()).unwrap_or(true)
        })
        .ok_or("could not pick a worktree name")?;

    let path_str = path.to_string_lossy().into_owned();
    git_ok(&top, &["worktree", "add", "-b", &format!("aurelia/{name}"), &path_str])?;
    // Keep the agent in the same subdirectory it was started from.
    let rel = start.strip_prefix(&top).ok().filter(|r| !r.as_os_str().is_empty());
    Ok(match rel {
        Some(r) if path.join(r).is_dir() => path.join(r).to_string_lossy().into_owned(),
        _ => path_str,
    })
}

const MAX_DIFF: usize = 2 * 1024 * 1024;
const MAX_UNTRACKED: usize = 40;
const MAX_UNTRACKED_BYTES: u64 = 200 * 1024;

#[derive(Serialize)]
pub struct Diff {
    root: String,
    diff: String,
    truncated: bool,
}

/// Uncommitted changes (staged + unstaged + untracked) relative to HEAD.
#[tauri::command]
pub fn git_diff(cwd: String) -> Result<Diff, String> {
    let start = PathBuf::from(expand_path(&cwd));
    let top = PathBuf::from(git_ok(&start, &["rev-parse", "--show-toplevel"]).map_err(|_| "not inside a git repository".to_string())?);
    let base = ["diff", "--no-color", "--no-ext-diff", "-U3"];
    let tracked = match git_ok(&top, &[&base[..], &["HEAD"]].concat()) {
        Ok(d) => d,
        Err(_) => git_ok(&top, &base)?, // no commits yet
    };
    let mut diff = tracked;
    let untracked = git_ok(&top, &["ls-files", "--others", "--exclude-standard"])?;
    for file in untracked.lines().filter(|l| !l.is_empty()).take(MAX_UNTRACKED) {
        if fs::metadata(top.join(file)).map(|m| m.len() > MAX_UNTRACKED_BYTES).unwrap_or(true) {
            continue;
        }
        // Exits 1 when the files differ, which is always the case here.
        let out = git(&top, &["diff", "--no-color", "--no-ext-diff", "--no-index", "--", "/dev/null", file])?;
        if !diff.is_empty() {
            diff.push('\n');
        }
        diff.push_str(String::from_utf8_lossy(&out.stdout).trim_end());
        if diff.len() > MAX_DIFF {
            break;
        }
    }
    let truncated = diff.len() > MAX_DIFF;
    if truncated {
        let mut cut = MAX_DIFF;
        while !diff.is_char_boundary(cut) {
            cut -= 1;
        }
        diff.truncate(cut);
    }
    Ok(Diff { root: top.to_string_lossy().into_owned(), diff, truncated })
}
