//! App config (`~/Library/Application Support/AureliaSpace/config.json`) and
//! small JSON state files (layout, tasks) stored next to it.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub fn home_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".into()))
}

pub fn app_dir() -> PathBuf {
    home_dir().join("Library/Application Support/AureliaSpace")
}

/// Expands a leading `~` and strips trailing slashes, so the result matches the
/// string Claude Code hashes for its keychain service name.
pub fn expand_path(p: &str) -> String {
    let expanded = if p == "~" {
        home_dir().to_string_lossy().into_owned()
    } else if let Some(rest) = p.strip_prefix("~/") {
        home_dir().join(rest).to_string_lossy().into_owned()
    } else {
        p.to_string()
    };
    let trimmed = expanded.trim_end_matches('/');
    if trimmed.is_empty() { "/".into() } else { trimmed.into() }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub name: String,
    pub config_dir: String,
}

impl Account {
    pub fn resolved_dir(&self) -> String {
        expand_path(&self.config_dir)
    }

    /// The default account (`~/.claude`) must run without CLAUDE_CONFIG_DIR, otherwise
    /// Claude Code looks for a different keychain entry and `.claude.json`.
    pub fn is_default(&self) -> bool {
        self.resolved_dir() == expand_path("~/.claude")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProviderConfig {
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SuggestionsConfig {
    /// "ollama" | "gemini" | "openrouter"
    pub provider: String,
    pub ollama: ProviderConfig,
    pub gemini: ProviderConfig,
    pub openrouter: ProviderConfig,
}

impl Default for SuggestionsConfig {
    fn default() -> Self {
        Self {
            provider: "ollama".into(),
            ollama: ProviderConfig {
                base_url: "http://localhost:11434".into(),
                model: "qwen2.5-coder:1.5b".into(),
            },
            gemini: ProviderConfig {
                base_url: "https://generativelanguage.googleapis.com/v1beta".into(),
                model: "gemini-2.5-flash".into(),
            },
            openrouter: ProviderConfig {
                base_url: "https://openrouter.ai/api/v1".into(),
                model: "qwen/qwen-2.5-coder-32b-instruct:free".into(),
            },
        }
    }
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self { base_url: String::new(), model: String::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TerminalConfig {
    pub font_family: String,
    pub font_size: f32,
    pub line_height: f32,
    pub scrollback: u32,
    pub option_as_meta: bool,
    /// Panes beyond this count use the DOM renderer instead of WebGL.
    pub webgl_pane_limit: u32,
    pub shell: String,
}

impl Default for TerminalConfig {
    fn default() -> Self {
        Self {
            font_family: "\"JetBrains Mono\", \"SF Mono\", Menlo, Monaco, monospace".into(),
            font_size: 13.0,
            line_height: 1.15,
            scrollback: 10000,
            option_as_meta: true,
            webgl_pane_limit: 12,
            shell: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CacheConfig {
    /// Prompt-cache TTL in minutes: 5 (default API TTL) or 60 (1-hour TTL).
    pub ttl_minutes: u32,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self { ttl_minutes: 60 }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VoiceConfig {
    /// Tidy dictation typed into plain shell panes ("dash dash" -> "--", trailing period dropped).
    pub shell_cleanup: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HudConfig {
    /// Floating session HUD, shown only while AureliaSpace isn't the focused app.
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiscordConfig {
    /// Discord Rich Presence; on by default, like a game's.
    pub enabled: bool,
    /// Unused: AureliaSpace ships its own Discord application. Kept so old configs parse.
    pub client_id: String,
    /// Show "Working in a project" instead of the project name.
    pub hide_project: bool,
}

impl Default for DiscordConfig {
    fn default() -> Self {
        Self { enabled: true, client_id: String::new(), hide_project: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub accounts: Vec<Account>,
    pub usage_script: String,
    pub usage_refresh_seconds: u64,
    /// "system" | "light" | "dark"
    pub theme: String,
    /// Named color palette: "aurelia" | "midnight" | "nord" | "solarized" | "rose-pine" | "catppuccin"
    pub palette: String,
    pub notifications: bool,
    /// Command used to open files (receives `path[:line[:col]]`); empty = Cursor, then
    /// VS Code, then the default app.
    pub editor: String,
    /// Folder new panes open in when they have no cwd to inherit.
    pub default_workspace: String,
    pub terminal: TerminalConfig,
    pub suggestions: SuggestionsConfig,
    pub cache: CacheConfig,
    pub voice: VoiceConfig,
    pub hud: HudConfig,
    pub discord: DiscordConfig,
    /// Account new Claude panes use when none is chosen; empty = ask.
    pub default_account: String,
    /// Folder -> account name; wins over `default_account` for panes in that folder.
    pub workspace_accounts: std::collections::HashMap<String, String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            accounts: detect_accounts(),
            usage_script: "~/.claude/fetch-usage.sh".into(),
            usage_refresh_seconds: 180,
            theme: "system".into(),
            palette: "aurelia".into(),
            notifications: true,
            editor: String::new(),
            default_workspace: "~".into(),
            terminal: TerminalConfig::default(),
            suggestions: SuggestionsConfig::default(),
            cache: CacheConfig::default(),
            voice: VoiceConfig::default(),
            hud: HudConfig::default(),
            discord: DiscordConfig::default(),
            default_account: String::new(),
            workspace_accounts: Default::default(),
        }
    }
}

/// First-run default: every `~/.claude` / `~/.claude-*` directory becomes an account.
fn detect_accounts() -> Vec<Account> {
    let mut accounts: Vec<Account> = fs::read_dir(home_dir())
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    let is_claude = name == ".claude"
                        || name.strip_prefix(".claude-").is_some_and(|s| !s.is_empty());
                    is_claude.then(|| Account {
                        name: name.trim_start_matches('.').into(),
                        config_dir: format!("~/{name}"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    accounts.sort_by(|a, b| a.name.cmp(&b.name));
    if accounts.is_empty() {
        accounts.push(Account { name: "claude".into(), config_dir: "~/.claude".into() });
    }
    accounts
}

pub fn config_path() -> PathBuf {
    app_dir().join("config.json")
}

/// Loads config, writing the default file on first run. A malformed file falls back
/// to defaults without being overwritten, so hand edits are never lost.
pub fn load() -> Config {
    let path = config_path();
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
            eprintln!("[aurelia] config.json is invalid ({e}); using defaults");
            Config::default()
        }),
        Err(_) => {
            let cfg = Config::default();
            let _ = write_json(&path, &serde_json::to_value(&cfg).unwrap_or(Value::Null));
            cfg
        }
    }
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Only these state files may be read/written from the frontend.
fn state_path(name: &str) -> Result<PathBuf, String> {
    match name {
        "layout" | "tasks" | "ui" | "recents" => Ok(app_dir().join(format!("{name}.json"))),
        _ => Err(format!("unknown state file: {name}")),
    }
}

#[tauri::command]
pub fn get_config() -> Config {
    load()
}

/// Trims and checks accounts so a bad edit can't leave panes pointing at a missing or duplicated account.
fn validate_accounts(accounts: &mut [Account]) -> Result<(), String> {
    if accounts.is_empty() {
        return Err("at least one account is required".into());
    }
    for a in accounts.iter_mut() {
        a.name = a.name.trim().to_string();
        a.config_dir = a.config_dir.trim().to_string();
        if a.name.is_empty() || a.config_dir.is_empty() {
            return Err("every account needs a name and a config folder".into());
        }
    }
    for (i, a) in accounts.iter().enumerate() {
        if accounts[..i].iter().any(|b| b.name.eq_ignore_ascii_case(&a.name)) {
            return Err(format!("duplicate account name '{}'", a.name));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_config(mut config: Config) -> Result<(), String> {
    validate_accounts(&mut config.accounts)?;
    write_json(&config_path(), &serde_json::to_value(&config).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub fn load_state(name: String) -> Result<Option<Value>, String> {
    let path = state_path(&name)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(serde_json::from_str(&text).ok()),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn save_state(name: String, value: Value) -> Result<(), String> {
    write_json(&state_path(&name)?, &value)
}

/// Opens the config folder (or config.json in the default text editor).
#[tauri::command]
pub fn reveal_config(file: bool) -> Result<(), String> {
    let mut cmd = std::process::Command::new("open");
    if file {
        load(); // make sure it exists
        cmd.arg("-t").arg(config_path());
    } else {
        cmd.arg(app_dir());
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Nearest ancestor containing `.git`, else the directory itself. Used as the task-list key.
#[tauri::command]
pub fn project_root(cwd: String) -> String {
    let start = PathBuf::from(expand_path(&cwd));
    let mut dir = start.as_path();
    loop {
        if dir.join(".git").exists() {
            return dir.to_string_lossy().into_owned();
        }
        match dir.parent() {
            Some(p) => dir = p,
            None => return start.to_string_lossy().into_owned(),
        }
    }
}
