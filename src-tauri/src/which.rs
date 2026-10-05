use std::path::PathBuf;
use std::process::Command;

fn find_in_dirs(cmd: &str, dirs: impl Iterator<Item = PathBuf>) -> bool {
    use std::os::unix::fs::PermissionsExt;
    dirs.map(|d| d.join(cmd))
        .any(|p| p.metadata().map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false))
}

/// True if `cmd` is an executable on PATH. GUI apps get a minimal PATH on macOS, so
/// common install dirs are checked too, then the user's login shell as a last resort.
#[tauri::command]
pub async fn which(cmd: String) -> bool {
    if cmd.is_empty() || !cmd.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
        return false;
    }
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        for sub in [".local/bin", ".npm-global/bin", ".bun/bin", ".volta/bin", ".cargo/bin"] {
            dirs.push(home.join(sub));
        }
    }
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(PathBuf::from(d));
    }
    if find_in_dirs(&cmd, dirs.into_iter()) {
        return true;
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    Command::new(shell)
        .args(["-lc", &format!("command -v {cmd}")])
        .output()
        .map(|o| o.status.success() && !o.stdout.is_empty())
        .unwrap_or(false)
}
