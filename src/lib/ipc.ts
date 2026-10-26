import { Channel, invoke } from "@tauri-apps/api/core";

export interface Account {
  name: string;
  configDir: string;
}

export interface RemoteStatus {
  enabled: boolean;
  running: boolean;
  port: number | null;
  error: string | null;
  /** Pairing links a phone can open, best first. */
  links: { label: string; url: string }[];
  qrSvg: string | null;
  tailscale: boolean;
  clients: number;
}

export interface Checkpoint {
  sha: string;
  /** Epoch ms. */
  at: number;
  label: string;
}

export interface Routine {
  id: string;
  name: string;
  enabled: boolean;
  /** "daily" at `time` (HH:MM, local), or "every" `minutes`. */
  kind: "daily" | "every";
  time: string;
  minutes: number;
  weekdaysOnly: boolean;
  account: string;
  cwd: string;
  prompt: string;
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
  /** Alert sounds, played in-app so macOS Focus can't mute them (src/lib/sounds.ts). */
  sounds: { enabled: boolean; volume: number; events: Record<string, string>; projects: Record<string, Record<string, string>> };
  /** Phone alerts through an ntfy topic (src/lib/push.ts). */
  push: { enabled: boolean; server: string; topic: string; detail: boolean };
  hud: { enabled: boolean };
  discord: { enabled: boolean; clientId: string; hideProject: boolean };
  /** Account new Claude panes use when none is chosen; empty = ask. */
  defaultAccount: string;
  /** Folder -> account name; wins over `defaultAccount` for panes in that folder. */
  workspaceAccounts: Record<string, string>;
  /** Command that opens `path[:line[:col]]`; empty = Cursor, then VS Code, then default app. */
  editor: string;
  /** Folder new panes open in when they have no cwd to inherit. */
  defaultWorkspace: string;
  /** Claude panes restored at launch reopen the conversation they last ran. */
  resumeOnLaunch: boolean;
  /** `--permission-mode` for Claude panes started here ("acceptEdits", "plan", …); empty = Auto-edit, "default" = Claude's own ask-before-edits. */
  claudePermissionMode: string;
  /** ⌘-clicked paths and the Files view open in an editor pane; off = the external `editor`. */
  openFilesInApp: boolean;
  /** `aurelia_*` tools: Claude panes may list, read and message other panes and show HTML. */
  orchestrator: boolean;
  /** `deepseek_agent` tool for Claude panes: tasks handed to OpenCode (src-tauri/src/subagents.rs). */
  subagents: { enabled: boolean; model: string; timeoutMinutes: number };
  /** Scheduled prompts that open a Claude pane while the app runs (src/lib/routines.ts). */
  routines: Routine[];
  /** Composer prompts pick their own effort: rules, then a Haiku 5.5 judge (src-tauri/src/effort.rs). */
  effort: { auto: boolean; judge: boolean; floor: EffortLevel; ceiling: EffortLevel; autoModel: boolean };
  /** Phone remote (src-tauri/src/remote.rs): off by default; LAN off = this Mac and Tailscale only. */
  remote: { enabled: boolean; port: number; allowLan: boolean };
  terminal: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    scrollback: number;
    optionAsMeta: boolean;
    webglPaneLimit: number;
    shell: string;
    /** Shells keep running in the terminal host while the app quits or restarts. */
    keepAlive: boolean;
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

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface EffortPick {
  /** null = leave the effort as it is (e.g. "continue" mid-task). */
  level: EffortLevel | null;
  source: "rules" | "judge" | "keep";
  why: string;
  /** A rules-only preview of a prompt the judge decides on send. */
  pending: boolean;
}

/** A DeepSeek review of a repo's uncommitted changes (src-tauri/src/review.rs). */
export interface ReviewResult {
  text: string;
  verdict: "ship" | "fix" | "block" | null;
  scorers: string[];
  model: string;
  seconds: number;
  failed: boolean;
}

export interface Usage {
  fiveHour: number | null;
  sevenDay: number | null;
  fiveHourResetsAt: string | null;
  sevenDayResetsAt: string | null;
  updatedAt: number;
  /** "live": read by a Claude pane from its own API responses; otherwise polled from the usage endpoint. */
  source?: "live" | "poll";
}

export interface TranscriptUsage {
  id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cache_creation_1h_tokens: number;
  timestamp: string;
}

export interface GitInfo {
  root: string;
  branch: string;
  detached: boolean;
  worktree: boolean;
  /** The main checkout's root (same as `root` outside a linked worktree). */
  repo: string;
}

/** The pull request for a branch (src-tauri/src/pr.rs). */
export interface PrInfo {
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  draft: boolean;
  review: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "";
  conflicts: boolean;
  checks: "none" | "pending" | "pass" | "fail";
  failing: string[];
  /** Reviews plus conversation comments; a rise means new feedback. */
  feedback: number;
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

/** IDE mode (src-tauri/src/ide.rs). */
export interface SearchMatch {
  path: string;
  line: number;
  /** 1-based character column of the first match, and its length. */
  col: number;
  len: number;
  text: string;
}

export interface Problem {
  path: string;
  line: number;
  col: number;
  severity: "error" | "warning";
  message: string;
  source: "tsc" | "cargo";
}

export interface ThreadItem {
  role: "user" | "assistant" | "tool";
  text: string;
  tool?: string;
  error?: boolean;
}

export interface SuggestRequest {
  prompt: string;
  cwd?: string;
  recentCommands: string[];
  lastOutput?: string;
}

/** What src-tauri/src/chat.rs sends a chat pane. */
export type ChatEvent =
  | { type: "raw"; msg: Record<string, unknown> }
  | { type: "session"; id: string }
  | { type: "status"; status: "working" | "waiting" | "idle" }
  | { type: "approval"; id: string; tool: string; input: Record<string, unknown>; description?: string | null }
  | { type: "turnEnd"; outcome: "completed" | "interrupted" | "failed"; error?: string | null; usage?: ChatUsage | null; durationMs?: number | null }
  | { type: "controlError"; error: string }
  | { type: "exit"; code?: number | null; stderr: string };

/** A slash command the chat's CLI knows: built-in, custom command or skill. */
export type RuleKind = "allow" | "ask" | "deny";

/** One settings file's saved permission rules (src-tauri/src/rules.rs). */
export interface RuleFile {
  scope: "local" | "project" | "user";
  path: string;
  allow: string[];
  ask: string[];
  deny: string[];
}

/** A pasted image, sent to Claude as a base64 block. */
export interface ChatImage {
  mediaType: string;
  data: string;
}

/** A model Claude Code offers, from its `initialize` answer. */
export interface CliModel {
  value: string;
  displayName: string;
  description?: string;
  supportedEffortLevels?: string[];
}

export interface SlashCommand {
  name: string;
  description?: string;
  argumentHint?: string;
  builtin?: boolean;
}

/** Claude Code's `/context` for a chat: what fills its window. */
export interface ContextUsage {
  categories: { id?: string; name: string; tokens: number; kind?: "used" | "deferred" | "buffer" | "free"; isDeferred?: boolean }[];
  totalTokens: number;
  maxTokens: number;
  percentage: number;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  contextTokens?: number | null;
  contextWindow?: number | null;
}

export const ipc = {
  ptySpawn(args: {
    paneId: string;
    cwd?: string;
    account?: string;
    /** Plain env for an agent CLI. */
    env?: Record<string, string>;
    /** Env var name -> Keychain key id; Rust injects the secret at spawn. */
    secretEnv?: Record<string, string>;
    cols: number;
    rows: number;
    /** Start a new shell even if the terminal host still runs one for this pane. */
    fresh?: boolean;
    onData: Channel<ArrayBuffer>;
  }) {
    return invoke<{ attached: boolean; missingCwd?: string | null }>("pty_spawn", args);
  },
  /** Starts Claude Code headless for a chat pane (src-tauri/src/chat.rs); events arrive on `onEvent`. */
  chatSpawn(args: {
    paneId: string;
    cwd?: string;
    account?: string;
    env?: Record<string, string>;
    secretEnv?: Record<string, string>;
    /** Session id to continue. */
    resume?: string;
    /** With `resume`: continue a copy cut at this entry (editing an earlier message). */
    resumeAt?: string;
    /** With `resume`: continue a copy of the whole conversation as a new session. */
    fork?: boolean;
    /** "opus", "sonnet", "haiku" or "default"; effort "low" … "max" or "default". */
    model?: string;
    effort?: string;
    /** Claude Code's `--permission-mode`; unset = its own default (ask). */
    permissionMode?: string;
    onEvent: Channel<ChatEvent>;
  }) {
    return invoke<{ missingCwd?: string | null }>("chat_spawn", args);
  },
  permissionRules: (cwd: string, account: string | null) => invoke<RuleFile[]>("permission_rules", { cwd, account }),
  removePermissionRule: (cwd: string, account: string | null, path: string, kind: RuleKind, rule: string) =>
    invoke<void>("remove_permission_rule", { cwd, account, path, kind, rule }),
  chatSend: (paneId: string, text: string, images?: ChatImage[], uuid?: string) => invoke<void>("chat_send", { paneId, text, images, uuid }),
  chatRewind: (paneId: string, uuid: string, dryRun: boolean) =>
    invoke<{ canRewind: boolean; filesChanged?: string[]; insertions?: number; deletions?: number }>("chat_rewind", { paneId, uuid, dryRun }),
  /** Switches a running chat's model and/or effort for its next turns. */
  chatConfigure: (paneId: string, model?: string, effort?: string, style?: string) => invoke<void>("chat_configure", { paneId, model, effort, style }),
  /** Switches the chat's permission mode now (Shift+Tab in the CLI). */
  chatSetMode: (paneId: string, mode: string) => invoke<void>("chat_set_mode", { paneId, mode }),
  chatCommands: (paneId: string) => invoke<{ commands: SlashCommand[]; models?: CliModel[]; styles?: string[]; style?: string }>("chat_commands", { paneId }),
  chatContextUsage: (paneId: string) => invoke<ContextUsage>("chat_context_usage", { paneId }),
  chatInterrupt: (paneId: string) => invoke<void>("chat_interrupt", { paneId }),
  /**
   * `input` replaces the tool's input, e.g. AskUserQuestion's `answers`; `permissions` are
   * Claude Code permission updates to apply with it; `message` says why it was denied.
   */
  chatAnswer: (paneId: string, id: string, allow: boolean, always = false, input?: Record<string, unknown>, permissions?: unknown[], message?: string) =>
    invoke<void>("chat_answer", { paneId, id, allow, always, input, permissions, message }),
  chatKill: (paneId: string) => invoke<void>("chat_kill", { paneId }),
  /** Transcript lines of a session the chat resumes, oldest first. */
  chatParent: (account: string | undefined, cwd: string, session: string, uuid: string) =>
    invoke<string | null>("chat_parent", { account, cwd, session, uuid }),
  chatHistory: (account: string | undefined, cwd: string, session: string) =>
    invoke<Record<string, unknown>[]>("chat_history", { account, cwd, session }),
  ptyWrite: (paneId: string, data: string) => invoke<void>("pty_write", { paneId, data }),
  ptyWriteBinary: (paneId: string, data: number[]) => invoke<void>("pty_write_binary", { paneId, data }),
  ptyResize: (paneId: string, cols: number, rows: number) => invoke<void>("pty_resize", { paneId, cols, rows }),
  /** xterm has parsed `bytes` more of the pane's output (PTY flow control, see pty.rs). */
  ptyAck: (paneId: string, bytes: number) => invoke<void>("pty_ack", { paneId, bytes }),
  ptyKill: (paneId: string) => invoke<void>("pty_kill", { paneId }),
  /** Panes still running in the terminal host (src-tauri/src/ptyhost.rs), e.g. from before a restart. */
  ptyAlive: () => invoke<string[]>("pty_alive"),
  ptyPrune: (keep: string[]) => invoke<number>("pty_prune", { keep }),
  ptyStopBackground: () => invoke<number>("pty_stop_background"),
  remoteStatus: () => invoke<RemoteStatus>("remote_status"),
  /** After saving `remote` settings: starts, restarts or stops the server. */
  remoteApply: () => invoke<RemoteStatus>("remote_apply"),
  remoteResetToken: () => invoke<RemoteStatus>("remote_reset_token"),
  remoteSnapshot: (snapshot: unknown) => invoke<void>("remote_snapshot", { snapshot }),
  takePromptLinks: () => invoke<string[]>("take_prompt_links"),
  snapCapture: () => invoke<string | null>("snap_capture"),
  checkpointCreate: (cwd: string, pane: string, label: string) => invoke<Checkpoint | null>("checkpoint_create", { cwd, pane, label }),
  checkpointList: (cwd: string, pane: string) => invoke<Checkpoint[]>("checkpoint_list", { cwd, pane }),
  checkpointRestore: (cwd: string, pane: string, sha: string) => invoke<number>("checkpoint_restore", { cwd, pane, sha }),
  /** The frontend listens for agent events now: start (re)playing them. */
  agentEventsReady: () => invoke<void>("agent_events_ready"),

  getConfig: () => invoke<Config>("get_config"),
  saveConfig: (config: Config) => invoke<void>("save_config", { config }),
  loadState: <T>(name: "layout" | "tasks" | "ui" | "recents" | "agents" | "prompts" | "routines") => invoke<T | null>("load_state", { name }),
  saveState: (name: "layout" | "tasks" | "ui" | "recents" | "agents" | "prompts" | "routines", value: unknown) => invoke<void>("save_state", { name, value }),
  pickFolder: (start?: string) => invoke<string | null>("pick_folder", { start: start ?? null }),
  revealConfig: (file: boolean) => invoke<void>("reveal_config", { file }),
  browserOpen: (pane: string, url: string, r: { x: number; y: number; w: number; h: number }) =>
    invoke<void>("browser_open", { pane, url, ...r }),
  browserBounds: (pane: string, r: { x: number; y: number; w: number; h: number }) => invoke<void>("browser_bounds", { pane, ...r }),
  browserVisible: (pane: string, visible: boolean) => invoke<void>("browser_visible", { pane, visible }),
  browserNavigate: (pane: string, url: string) => invoke<void>("browser_navigate", { pane, url }),
  browserAction: (pane: string, action: "back" | "forward" | "reload") => invoke<void>("browser_action", { pane, action }),
  browserClose: (pane: string) => invoke<void>("browser_close", { pane }),
  discordSet: (presence: { clientId: string; details: string; state?: string; startedAt?: number } | null) =>
    invoke<void>("discord_set", { presence }),
  projectRoot: (cwd: string) => invoke<string>("project_root", { cwd }),

  projectFiles: (cwd: string) => invoke<string[]>("project_files", { cwd }),
  listDir: (path: string) => invoke<DirEntry[]>("list_dir", { path }),
  resolvePaths: (cwd: string, candidates: string[]) => invoke<(string | null)[]>("resolve_paths", { cwd, candidates }),
  openPath: (path: string, line?: number, col?: number) => invoke<void>("open_path", { path, line, col }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  readTextFile: (path: string) => invoke<{ text: string; mtimeMs: number }>("read_text_file", { path }),
  /** Returns the new mtime; rejects with "CHANGED_ON_DISK" when `expectedMtimeMs` is stale (null = overwrite). */
  writeTextFile: (path: string, text: string, expectedMtimeMs: number | null) =>
    invoke<number>("write_text_file", { path, text, expectedMtimeMs }),
  fileMtime: (path: string) => invoke<number>("file_mtime", { path }),
  searchProject: (root: string, query: string, regex: boolean, caseSensitive: boolean) =>
    invoke<SearchMatch[]>("search_project", { root, query, regex, caseSensitive }),
  checkProject: (root: string) => invoke<{ problems: Problem[]; ran: string[] }>("check_project", { root }),
  transcriptThread: (path: string, maxItems: number) => invoke<ThreadItem[]>("transcript_thread", { path, maxItems }),
  hasFullDiskAccess: () => invoke<boolean>("has_full_disk_access"),
  openFullDiskAccessSettings: () => invoke<void>("open_full_disk_access_settings"),

  gitInfo: (cwd: string) => invoke<GitInfo | null>("git_info", { cwd }),
  createWorktree: (cwd: string, label: string) => invoke<string>("create_worktree", { cwd, label }),
  gitDiff: (cwd: string) => invoke<Diff>("git_diff", { cwd }),
  prStatus: (cwd: string) => invoke<PrInfo | null>("pr_status", { cwd }),

  fetchUsage: (account: string, force = false) => invoke<Usage | null>("fetch_usage", { account, force }),

  handoffPrepare: (transcriptPath: string, toAccount: string) =>
    invoke<{ sessionId: string; path: string }>("handoff_prepare", { transcriptPath, toAccount }),
  chooseEffort: (account: string | null, prompt: string, useJudge: boolean) =>
    invoke<EffortPick>("choose_effort", { account, prompt, useJudge }),
  reviewChanges: (cwd: string) => invoke<ReviewResult>("review_changes", { cwd }),
  chooseModel: (account: string | null, prompt: string) =>
    invoke<{ model: "haiku" | "sonnet" | "opus"; source: "rules" | "judge"; why: string }>("choose_model", { account, prompt }),
  resumableSession: (account: string, cwd: string, prefer: string | null) =>
    invoke<string | null>("resumable_session", { account, cwd, prefer }),
  handoffSummary: (transcriptPath: string, maxChars: number) => invoke<string>("handoff_summary", { transcriptPath, maxChars }),
  transcriptUsage: (path: string, offset: number) =>
    invoke<{ entries: TranscriptUsage[]; offset: number }>("transcript_usage", { path, offset }),

  suggestCommand: (request: SuggestRequest) => invoke<string>("suggest_command", { request }),
  setApiKey: (provider: ProviderName, key: string) => invoke<void>("set_api_key", { provider, key }),
  hasApiKey: (provider: ProviderName) => invoke<boolean>("has_api_key", { provider }),

  setAgentKey: (id: string, key: string) => invoke<void>("set_agent_key", { id, key }),
  agentKeysPresent: (ids: string[]) => invoke<string[]>("agent_keys_present", { ids }),
  which: (cmd: string) => invoke<boolean>("which", { cmd }),

  voiceToggle: () => invoke<void>("voice_toggle"),
  voiceInstalled: () => invoke<boolean>("voice_installed"),
};
