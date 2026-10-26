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
    /// The main checkout's root (same as `root` outside a linked worktree), so a project's
    /// worktrees group under it.
    pub repo: String,
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
    // <repo>/.git/worktrees/<name> → <repo>
    let repo = if worktree { gitdir.parent().and_then(Path::parent).and_then(Path::parent).map(Path::to_path_buf) } else { None }.unwrap_or_else(|| root.clone());
    Some(GitInfo { root: root.to_string_lossy().into_owned(), branch, detached, worktree, repo: repo.to_string_lossy().into_owned() })
}

fn git(dir: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git").arg("-C").arg(dir).args(["-c", "core.quotepath=false"]).args(args).output().map_err(|e| format!("git: {e}"))
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeEntry {
    pub path: String,
    pub branch: String,
    /// Uncommitted or untracked files: removing it would lose work.
    pub dirty: bool,
}

/// `<repo parent>/<repo>.worktrees/`, where create_worktree puts them. Only worktrees in
/// here are offered for cleanup, so one made by hand elsewhere is never touched.
fn worktrees_dir(repo: &Path) -> Option<PathBuf> {
    let name = repo.file_name()?.to_string_lossy().into_owned();
    Some(repo.parent()?.join(format!("{name}.worktrees")))
}

/// The main checkout of the repository `dir` belongs to (worktree or not).
fn main_checkout(dir: &Path) -> Result<PathBuf, String> {
    let common = git_ok(dir, &["rev-parse", "--path-format=absolute", "--git-common-dir"]).map_err(|_| "not inside a git repository".to_string())?;
    let common = PathBuf::from(common);
    let repo = if common.file_name().is_some_and(|n| n == ".git") { common.parent().map(Path::to_path_buf) } else { None };
    repo.ok_or_else(|| "bare repositories aren't supported".into())
}

/// Parses `git worktree list --porcelain` into (path, branch) pairs, skipping the main checkout.
fn parse_worktrees(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for block in text.split("\n\n").skip(1) {
        let mut path = None;
        let mut branch = String::new();
        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = Some(p.to_string());
            } else if let Some(b) = line.strip_prefix("branch ") {
                branch = b.strip_prefix("refs/heads/").unwrap_or(b).to_string();
            } else if line == "detached" {
                branch = "(detached)".into();
            }
        }
        if let Some(p) = path {
            out.push((p, branch));
        }
    }
    out
}

/// The repository's AureliaSpace worktrees (the ones under `<repo>.worktrees/`).
#[tauri::command]
pub fn list_worktrees(cwd: String) -> Result<Vec<WorktreeEntry>, String> {
    let repo = main_checkout(&PathBuf::from(expand_path(&cwd)))?;
    let Some(home) = worktrees_dir(&repo) else { return Ok(vec![]) };
    let home = fs::canonicalize(&home).unwrap_or(home);
    let text = git_ok(&repo, &["worktree", "list", "--porcelain"])?;
    Ok(parse_worktrees(&text)
        .into_iter()
        .filter(|(p, _)| Path::new(p).starts_with(&home))
        .map(|(path, branch)| {
            // A folder deleted by hand counts as clean: there is nothing left to lose.
            let dirty = Path::new(&path).is_dir() && git_ok(Path::new(&path), &["status", "--porcelain"]).map(|s| !s.is_empty()).unwrap_or(true);
            WorktreeEntry { path, branch, dirty }
        })
        .collect())
}

/// Removes one of AureliaSpace's worktrees and its `aurelia/*` branch when that is merged.
/// Refuses a worktree with uncommitted changes, and anything outside `<repo>.worktrees/`.
#[tauri::command]
pub fn remove_worktree(path: String) -> Result<(), String> {
    let path = PathBuf::from(expand_path(&path));
    let listed = list_worktrees(path.to_string_lossy().into_owned()).map_err(|_| "not one of AureliaSpace's worktrees".to_string())?;
    let canon = fs::canonicalize(&path).unwrap_or(path.clone());
    let entry = listed
        .into_iter()
        .find(|w| Path::new(&w.path) == canon || Path::new(&w.path) == path)
        .ok_or("not one of AureliaSpace's worktrees")?;
    if entry.dirty {
        return Err(format!("{} has uncommitted changes", Path::new(&entry.path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
    }
    let repo = main_checkout(&canon)?;
    git_ok(&repo, &["worktree", "remove", &entry.path])?;
    // -d, not -D: an unmerged branch stays (a squash-merged one too; GitHub keeps the PR).
    if entry.branch.starts_with("aurelia/") {
        let _ = git_ok(&repo, &["branch", "-d", &entry.branch]);
    }
    let _ = git_ok(&repo, &["worktree", "prune"]);
    Ok(())
}

const MAX_DIFF: usize = 2 * 1024 * 1024;
const MAX_UNTRACKED: usize = 40;
const MAX_UNTRACKED_BYTES: u64 = 200 * 1024;

#[derive(Serialize)]
pub struct Diff {
    pub(crate) root: String,
    pub(crate) diff: String,
    pub(crate) truncated: bool,
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
    let untracked = git_ok(&top, &["ls-files", "-z", "--others", "--exclude-standard"])?;
    for file in untracked.split('\0').filter(|l| !l.is_empty()).take(MAX_UNTRACKED) {
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
    Ok(capped(&top, diff))
}

/// A diff cut to MAX_DIFF bytes (on a char boundary), so a huge change can't flood the UI.
pub(crate) fn capped(root: &Path, mut diff: String) -> Diff {
    let truncated = diff.len() > MAX_DIFF;
    if truncated {
        let mut cut = MAX_DIFF;
        while !diff.is_char_boundary(cut) {
            cut -= 1;
        }
        diff.truncate(cut);
    }
    Diff { root: root.to_string_lossy().into_owned(), diff, truncated }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> PathBuf {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let parent = std::env::temp_dir().join(format!("aurelia-wt-{}-{n}", std::process::id()));
        let dir = parent.join("repo");
        let _ = fs::remove_dir_all(&parent);
        fs::create_dir_all(&dir).unwrap();
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@t"], &["config", "user.name", "t"]] {
            git_ok(&dir, args).unwrap();
        }
        fs::write(dir.join("a.txt"), "one").unwrap();
        git_ok(&dir, &["add", "-A"]).unwrap();
        git_ok(&dir, &["commit", "-qm", "init"]).unwrap();
        fs::canonicalize(dir).unwrap()
    }

    #[test]
    fn removes_clean_worktree_and_merged_branch_but_keeps_dirty_and_foreign_ones() {
        let root = repo();
        let clean = create_worktree(root.to_string_lossy().into(), "one".into()).unwrap();
        let dirty = create_worktree(root.to_string_lossy().into(), "two".into()).unwrap();
        fs::write(Path::new(&dirty).join("new.txt"), "work").unwrap();
        let foreign = root.parent().unwrap().join("elsewhere");
        git_ok(&root, &["worktree", "add", "-q", "-b", "mine", &foreign.to_string_lossy()]).unwrap();

        let listed = list_worktrees(root.to_string_lossy().into()).unwrap();
        assert_eq!(listed.len(), 2, "the hand-made worktree isn't listed");
        assert!(listed.iter().any(|w| w.branch == "aurelia/two" && w.dirty));

        remove_worktree(clean.clone()).unwrap();
        assert!(!Path::new(&clean).exists());
        assert!(git_ok(&root, &["show-ref", "--verify", "--quiet", "refs/heads/aurelia/one"]).is_err(), "merged branch deleted");
        assert!(remove_worktree(dirty.clone()).unwrap_err().contains("uncommitted"));
        assert!(remove_worktree(foreign.to_string_lossy().into()).is_err());
        assert!(Path::new(&dirty).exists() && foreign.exists());
    }

    #[test]
    fn parses_porcelain_list_without_the_main_checkout() {
        let text = "worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r.worktrees/a\nHEAD def\nbranch refs/heads/aurelia/a\n\nworktree /r.worktrees/b\nHEAD 123\ndetached\n";
        assert_eq!(parse_worktrees(text), vec![("/r.worktrees/a".into(), "aurelia/a".into()), ("/r.worktrees/b".into(), "(detached)".into())]);
    }
}
