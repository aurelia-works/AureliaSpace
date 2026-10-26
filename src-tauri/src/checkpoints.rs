//! Checkpoints: before each Claude prompt, the working tree (tracked and untracked files,
//! minus ignored ones) is snapshotted as a commit under `refs/aurelia/checkpoints/<pane>/`,
//! built in a throwaway index so the real index, HEAD and branches are never touched.
//! Restoring writes a snapshot's files back and removes files created since, after taking
//! a checkpoint of the current state so the restore itself can be undone.

use crate::config::{app_dir, expand_path};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// Checkpoints kept per pane; older refs are dropped (git gc then frees their objects).
const KEEP: usize = 40;
/// Untracked files bigger than this (datasets, model weights, build output nobody ignored)
/// stay out of checkpoints, so they never pile up in `.git/objects`.
const MAX_UNTRACKED: u64 = 5 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub sha: String,
    /// Epoch ms.
    pub at: u64,
    pub label: String,
}

fn git(root: &Path, index: Option<&Path>, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(root).args(args);
    if let Some(index) = index {
        cmd.env("GIT_INDEX_FILE", index);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn repo_root(cwd: &str) -> Option<PathBuf> {
    git(Path::new(&expand_path(cwd)), None, &["rev-parse", "--show-toplevel"]).ok().map(PathBuf::from)
}

fn safe_pane(pane: &str) -> Result<&str, String> {
    if !pane.is_empty() && pane.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        Ok(pane)
    } else {
        Err(format!("bad pane id: {pane}"))
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The working tree as a git tree object, via a temporary index seeded from HEAD.
fn worktree_tree(root: &Path) -> Result<String, String> {
    let dir = app_dir().join("checkpoints");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let index = dir.join(format!("index-{}-{}", std::process::id(), now_ms()));
    let result = (|| {
        if git(root, None, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok() {
            git(root, Some(&index), &["read-tree", "HEAD"])?;
        }
        git(root, Some(&index), &["add", "-u", "--", "."])?;
        let untracked = git(root, None, &["ls-files", "-o", "--exclude-standard", "-z"])?;
        let small: Vec<&str> = untracked
            .split('\0')
            .filter(|p| !p.is_empty() && fs::metadata(root.join(p)).map(|m| m.is_file() && m.len() <= MAX_UNTRACKED).unwrap_or(false))
            .collect();
        for chunk in small.chunks(500) {
            let mut args = vec!["add", "--"];
            args.extend(chunk.iter().copied());
            git(root, Some(&index), &args)?;
        }
        git(root, Some(&index), &["write-tree"])
    })();
    let _ = fs::remove_file(&index);
    result
}

fn refs(root: &Path, pane: &str) -> Vec<(String, String, String)> {
    let prefix = format!("refs/aurelia/checkpoints/{pane}/");
    git(root, None, &["for-each-ref", "--sort=-refname", "--format=%(objectname) %(refname) %(contents:subject)", &prefix])
        .unwrap_or_default()
        .lines()
        .filter_map(|l| {
            let mut it = l.splitn(3, ' ');
            Some((it.next()?.to_string(), it.next()?.to_string(), it.next().unwrap_or("").to_string()))
        })
        .collect()
}

fn create(root: &Path, pane: &str, label: &str) -> Result<Option<Checkpoint>, String> {
    let tree = worktree_tree(root)?;
    let existing = refs(root, pane);
    // Nothing changed since the last checkpoint: don't stack identical ones.
    if let Some((sha, _, _)) = existing.first() {
        if git(root, None, &["rev-parse", &format!("{sha}^{{tree}}")]).ok().as_deref() == Some(tree.as_str()) {
            return Ok(None);
        }
    }
    let label = label.lines().next().unwrap_or("").chars().take(120).collect::<String>();
    let label = if label.trim().is_empty() { "Checkpoint".to_string() } else { label };
    let mut args = vec!["commit-tree", tree.as_str(), "-m", label.as_str()];
    let head = git(root, None, &["rev-parse", "--verify", "-q", "HEAD"]).ok();
    if let Some(h) = &head {
        args.extend(["-p", h.as_str()]);
    }
    let sha = git(root, None, &args)?;
    let at = now_ms();
    git(root, None, &["update-ref", &format!("refs/aurelia/checkpoints/{pane}/{at:015}"), &sha])?;
    for (_, name, _) in existing.iter().skip(KEEP - 1) {
        let _ = git(root, None, &["update-ref", "-d", name]);
    }
    Ok(Some(Checkpoint { sha, at, label }))
}

#[tauri::command]
pub async fn checkpoint_create(cwd: String, pane: String, label: String) -> Result<Option<Checkpoint>, String> {
    let pane = safe_pane(&pane)?.to_string();
    tauri::async_runtime::spawn_blocking(move || match repo_root(&cwd) {
        Some(root) => create(&root, &pane, &label),
        None => Ok(None),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn checkpoint_list(cwd: String, pane: String) -> Result<Vec<Checkpoint>, String> {
    let pane = safe_pane(&pane)?;
    let Some(root) = repo_root(&cwd) else { return Ok(vec![]) };
    Ok(refs(&root, pane)
        .into_iter()
        .map(|(sha, name, label)| Checkpoint { sha, at: name.rsplit('/').next().and_then(|n| n.parse().ok()).unwrap_or(0), label })
        .collect())
}

/// Puts the working tree back to checkpoint `sha`. Returns how many files changed.
#[tauri::command]
pub async fn checkpoint_restore(cwd: String, pane: String, sha: String) -> Result<usize, String> {
    let pane = safe_pane(&pane)?.to_string();
    if !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("bad checkpoint id".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = repo_root(&cwd).ok_or("not a git repository")?;
        let target = git(&root, None, &["rev-parse", &format!("{sha}^{{tree}}")])?;
        create(&root, &pane, "Before restore")?;
        let current = worktree_tree(&root)?;
        // Files created since the checkpoint go; files changed or deleted since come back.
        let added = git(&root, None, &["diff-tree", "-r", "--name-only", "-z", "--diff-filter=A", &target, &current])?;
        let changed = git(&root, None, &["diff-tree", "-r", "--name-only", "-z", "--diff-filter=MDT", &target, &current])?;
        let mut count = 0;
        for path in added.split('\0').filter(|p| !p.is_empty()) {
            if fs::remove_file(root.join(path)).is_ok() {
                count += 1;
            }
        }
        let paths: Vec<&str> = changed.split('\0').filter(|p| !p.is_empty()).collect();
        if !paths.is_empty() {
            let index = app_dir().join("checkpoints").join(format!("restore-{}", now_ms()));
            let result = (|| {
                git(&root, Some(&index), &["read-tree", &target])?;
                let mut args = vec!["checkout-index", "-f", "--"];
                args.extend(paths.iter().copied());
                git(&root, Some(&index), &args)
            })();
            let _ = fs::remove_file(&index);
            result?;
            count += paths.len();
        }
        Ok(count)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The branch this one would merge into: origin's default branch, else a local main/master.
fn base_ref(root: &Path) -> Option<String> {
    let origin = git(root, None, &["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]).ok();
    origin
        .into_iter()
        .chain(["origin/main", "origin/master", "main", "master"].map(String::from))
        .find(|r| git(root, None, &["rev-parse", "--verify", "-q", r]).is_ok())
}

/// The working tree (tracked and untracked) compared with a starting point: "turn" = the
/// thread's latest checkpoint, taken just before its last prompt, so only that turn's work
/// shows; "branch" = where this branch left its base, so everything the branch changes shows.
fn scoped_diff(root: &Path, pane: &str, scope: &str) -> Result<String, String> {
    let from = match scope {
        "turn" => refs(root, pane).first().map(|(sha, _, _)| sha.clone()).ok_or("No checkpoint yet: this thread hasn't started a turn here.")?,
        "branch" => {
            let base = base_ref(root).ok_or("Couldn't find a base branch (origin/HEAD, main or master).")?;
            git(root, None, &["merge-base", "HEAD", &base])?
        }
        other => return Err(format!("unknown scope: {other}")),
    };
    let tree = worktree_tree(root)?;
    git(root, None, &["diff", "--no-color", "--no-ext-diff", "-U3", &from, &tree])
}

#[tauri::command]
pub async fn diff_scope(cwd: String, pane: String, scope: String) -> Result<crate::git::Diff, String> {
    let pane = safe_pane(&pane)?.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let root = repo_root(&cwd).ok_or("not inside a git repository")?;
        Ok(crate::git::capped(&root, scoped_diff(&root, &pane, &scope)?))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> PathBuf {
        // Tests run in parallel: a counter keeps two repos made in the same millisecond apart.
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("aurelia-cp-{}-{}-{n}", std::process::id(), now_ms()));
        fs::create_dir_all(&dir).unwrap();
        for args in [&["init", "-q"][..], &["config", "user.email", "t@t"], &["config", "user.name", "t"]] {
            git(&dir, None, args).unwrap();
        }
        fs::write(dir.join("a.txt"), "one").unwrap();
        fs::write(dir.join(".gitignore"), "ignored.txt\n").unwrap();
        git(&dir, None, &["add", "-A"]).unwrap();
        git(&dir, None, &["commit", "-qm", "init"]).unwrap();
        dir
    }

    #[test]
    fn restores_edits_deletions_and_new_files_without_touching_index_or_ignored() {
        let root = repo();
        fs::write(root.join("untracked.txt"), "keep me").unwrap();
        fs::write(root.join("huge.bin"), vec![0u8; (MAX_UNTRACKED + 1) as usize]).unwrap();
        let cp = create(&root, "pane-1", "first prompt").unwrap().unwrap();
        // Unchanged tree: no duplicate checkpoint.
        assert!(create(&root, "pane-1", "again").unwrap().is_none());

        fs::write(root.join("a.txt"), "two").unwrap();
        fs::remove_file(root.join("untracked.txt")).unwrap();
        fs::write(root.join("new.txt"), "made by the agent").unwrap();
        fs::write(root.join("ignored.txt"), "local").unwrap();
        let status_before = git(&root, None, &["diff", "--cached", "--name-only"]).unwrap();

        let rt = tauri::async_runtime::block_on(checkpoint_restore(root.to_string_lossy().into(), "pane-1".into(), cp.sha.clone()));
        assert_eq!(rt.unwrap(), 3);
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "one");
        assert_eq!(fs::read_to_string(root.join("untracked.txt")).unwrap(), "keep me");
        assert!(!root.join("new.txt").exists());
        assert_eq!(fs::read_to_string(root.join("ignored.txt")).unwrap(), "local");
        // Never snapshotted, so a restore leaves it alone too.
        assert!(root.join("huge.bin").exists());
        assert!(git(&root, None, &["ls-tree", "-r", "--name-only", &cp.sha]).unwrap().lines().all(|l| l != "huge.bin"));
        assert_eq!(git(&root, None, &["diff", "--cached", "--name-only"]).unwrap(), status_before);

        // The restore saved what was there, so it can be undone.
        let list = checkpoint_list(root.to_string_lossy().into(), "pane-1".into()).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].label, "Before restore");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn turn_diff_shows_only_work_since_the_last_checkpoint_and_branch_diff_everything() {
        let root = repo();
        fs::write(root.join("a.txt"), "two").unwrap();
        assert!(scoped_diff(&root, "pane-2", "turn").is_err(), "no checkpoint yet");
        create(&root, "pane-2", "second prompt").unwrap().unwrap();
        fs::write(root.join("a.txt"), "three").unwrap();
        fs::write(root.join("new.txt"), "fresh").unwrap();
        let turn = scoped_diff(&root, "pane-2", "turn").unwrap();
        assert!(turn.contains("-two") && turn.contains("+three") && turn.contains("new.txt"), "{turn}");
        assert!(!turn.contains("-one"), "{turn}");
        let branch = scoped_diff(&root, "pane-2", "branch").unwrap();
        assert!(branch.contains("-one") && branch.contains("+three") && branch.contains("new.txt"), "{branch}");
        let _ = fs::remove_dir_all(&root);
    }
}
