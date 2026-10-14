use std::path::PathBuf;
use std::process::Command;

fn find_in_dirs(cmd: &str, dirs: impl Iterator<Item = PathBuf>) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    dirs.map(|d| d.join(cmd))
        .find(|p| p.metadata().map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false))
}

fn valid(cmd: &str) -> bool {
    !cmd.is_empty() && cmd.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

fn search_dirs(cmd: &str) -> Option<PathBuf> {
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
    find_in_dirs(cmd, dirs.into_iter())
}

/// What the user's login shell runs for `cmd`: a path, or an alias/function definition.
fn shell_lookup(cmd: &str) -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let out = Command::new(shell).args(["-lc", &format!("command -v {cmd}")]).output().ok()?;
    let found = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !found.is_empty()).then_some(found)
}

/// Full path of the executable `cmd`. GUI apps get a minimal PATH on macOS, so common
/// install dirs are checked too, then the user's login shell as a last resort.
pub fn locate(cmd: &str) -> Option<PathBuf> {
    if !valid(cmd) {
        return None;
    }
    search_dirs(cmd).or_else(|| shell_lookup(cmd).filter(|p| p.starts_with('/')).map(PathBuf::from))
}

/// True if `cmd` runs in the user's shell: an executable (see `locate`), alias or function.
#[tauri::command]
pub async fn which(cmd: String) -> bool {
    valid(&cmd) && (search_dirs(&cmd).is_some() || shell_lookup(&cmd).is_some())
}
