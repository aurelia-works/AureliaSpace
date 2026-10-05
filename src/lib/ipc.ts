import { Channel, invoke } from "@tauri-apps/api/core";

export interface Account {
  name: string;
  configDir: string;
}

export interface ProviderConfig {
  baseUrl: string;
  model: string;
}

export type ProviderName = "ollama" | "gemini" | "openrouter";

export interface Config {
  accounts: Account[];
  usageScript: string;
  usageRefreshSeconds: number;
  theme: "system" | "light" | "dark";
  palette: string;
  notifications: boolean;
  /** Command that opens `path[:line[:col]]`; empty = Cursor, then VS Code, then default app. */
  editor: string;
  /** Folder new panes open in when they have no cwd to inherit. */
  defaultWorkspace: string;
  terminal: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    scrollback: number;
    optionAsMeta: boolean;
    webglPaneLimit: number;
    shell: string;
  };
  suggestions: {
    provider: ProviderName;
    ollama: ProviderConfig;
    gemini: ProviderConfig;
    openrouter: ProviderConfig;
  };
  cache: {
    /** Prompt-cache TTL in minutes: 5 or 60. */
    ttlMinutes: number;
  };
  voice: {
    /** Tidy dictation typed into plain shell panes (never Claude panes). */
    shellCleanup: boolean;
  };
}

export interface Usage {
  fiveHour: number | null;
  sevenDay: number | null;
  fiveHourResetsAt: string | null;
  sevenDayResetsAt: string | null;
  updatedAt: number;
}

export interface GitInfo {
  root: string;
  branch: string;
  detached: boolean;
  worktree: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  dir: boolean;
}

export interface Diff {
  root: string;
  diff: string;
  truncated: boolean;
}

export interface SuggestRequest {
  prompt: string;
  cwd?: string;
  recentCommands: string[];
  lastOutput?: string;
}

export const ipc = {
  ptySpawn(args: {
    paneId: string;
    cwd?: string;
    account?: string;
    cols: number;
    rows: number;
    onData: Channel<ArrayBuffer>;
  }) {
    return invoke<void>("pty_spawn", args);
  },
  ptyWrite: (paneId: string, data: string) => invoke<void>("pty_write", { paneId, data }),
  ptyWriteBinary: (paneId: string, data: number[]) => invoke<void>("pty_write_binary", { paneId, data }),
  ptyResize: (paneId: string, cols: number, rows: number) => invoke<void>("pty_resize", { paneId, cols, rows }),
  ptyKill: (paneId: string) => invoke<void>("pty_kill", { paneId }),

  getConfig: () => invoke<Config>("get_config"),
  saveConfig: (config: Config) => invoke<void>("save_config", { config }),
  loadState: <T>(name: "layout" | "tasks" | "ui") => invoke<T | null>("load_state", { name }),
  saveState: (name: "layout" | "tasks" | "ui", value: unknown) => invoke<void>("save_state", { name, value }),
  pickFolder: (start?: string) => invoke<string | null>("pick_folder", { start: start ?? null }),
  revealConfig: (file: boolean) => invoke<void>("reveal_config", { file }),
  projectRoot: (cwd: string) => invoke<string>("project_root", { cwd }),

  listDir: (path: string) => invoke<DirEntry[]>("list_dir", { path }),
  resolvePaths: (cwd: string, candidates: string[]) => invoke<(string | null)[]>("resolve_paths", { cwd, candidates }),
  openPath: (path: string, line?: number, col?: number) => invoke<void>("open_path", { path, line, col }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),

  gitInfo: (cwd: string) => invoke<GitInfo | null>("git_info", { cwd }),
  createWorktree: (cwd: string, label: string) => invoke<string>("create_worktree", { cwd, label }),
  gitDiff: (cwd: string) => invoke<Diff>("git_diff", { cwd }),

  fetchUsage: (account: string, force = false) => invoke<Usage | null>("fetch_usage", { account, force }),

  suggestCommand: (request: SuggestRequest) => invoke<string>("suggest_command", { request }),
  setApiKey: (provider: ProviderName, key: string) => invoke<void>("set_api_key", { provider, key }),
  hasApiKey: (provider: ProviderName) => invoke<boolean>("has_api_key", { provider }),

  voiceToggle: () => invoke<void>("voice_toggle"),
  voiceInstalled: () => invoke<boolean>("voice_installed"),
};
