# PRD: AureliaSpace

Personal macOS terminal inspired by Warp and BridgeMind's BridgeSpace, built for running multiple Claude Code accounts side by side.

## Goal
Personal daily driver. Optimize for my workflow over polish or distribution.

## Stack
- **Shell:** Tauri 2 (Rust), macOS only (Apple silicon first)
- **Frontend:** React + TypeScript, Vite
- **Terminal rendering:** xterm.js (WebGL addon)
- **PTY:** `portable-pty` crate, one PTY per pane, streamed to the frontend over Tauri events/channels
- **State:** Zustand (frontend), JSON config in `~/Library/Application Support/<app>/`

## v1 Features

### 1. Command blocks
- zsh integration script (injected via `ZDOTDIR` or sourced rc snippet) emitting OSC markers from `preexec`/`precmd`: command start, command text, exit code, cwd.
- Frontend uses xterm.js markers/decorations to group output into blocks.
- Per block: command, duration, exit status badge, copy output, copy command, rerun.
- Fallback: panes without shell integration (e.g. inside vim, ssh) render as a normal terminal; alt-screen apps disable blocks.

### 2. Multi-pane layouts
- Tabs plus horizontal/vertical splits, drag to resize.
- Keyboard-driven: split, close, focus left/right/up/down, new tab.
- Layout saved and restored on relaunch (cwd per pane).
- Target: up to 16 live panes without UI lag.

### 3. Claude account switcher
- Accounts defined in config: `{ name, configDir }` (e.g. `claude` -> `~/.claude`, `claude-a` -> `~/.claude-a`, `claude-b` -> `~/.claude-b`).
- New pane can be launched "as" an account: sets `CLAUDE_CONFIG_DIR` and runs `claude`.
- Pane header shows the account name and 5h / 7d usage, reusing the existing per-account logic (`fetch-usage.sh`, keychain service `Claude Code-credentials-<sha256(dir)[:8]>`).
- Accounts are selected manually per pane; **no automatic rotation to evade rate limits** (possible terms-of-service issue).
- Credentials are read only by the local usage fetch; never logged or sent anywhere except Anthropic's usage endpoint.

### 4. Agent panel
- Sidebar listing running Claude Code sessions per pane: account, cwd, status (idle / working / needs input).
- Status via Claude Code hooks (`PreToolUse`, `Stop`, notifications) writing to a local socket or file the app watches.
- Simple task list (todo / doing / done) per project, attachable to a pane. Kanban is out of scope for v1.
- Notification when an agent finishes or needs input in a background pane.

### 5. Command suggestions
- Hotkey opens an input; natural language -> proposed shell command, shown inline, never auto-run.
- Backend (free): provider-agnostic. Default is local Ollama (small coder model, offline, no key). Optional free-tier cloud providers (Gemini, OpenRouter free models) with the key stored in macOS Keychain.
- Context sent: cwd, shell, last few commands. Excludes output unless user opts in.

## Non-goals (v1)
Windows/Linux, cloud sync, voice, error-explain/fix, plugin system, Kanban, theming beyond light/dark, public distribution/signing.

## Milestones
1. **Scaffold:** Tauri + React, one pane running zsh via PTY with xterm.js.
2. **Blocks:** shell integration + block UI.
3. **Layout:** tabs, splits, persistence, shortcuts.
4. **Accounts:** switcher, per-pane usage display.
5. **Agent panel:** hooks, status, notifications, task list.
6. **Suggestions:** hotkey, API call, inline result.

## Risks
- Command blocks in xterm.js are the hardest piece; alt-screen apps and prompt customizations (starship, p10k) can break marker parsing.
- 16 panes of WebGL xterm.js may stress WebKit's memory; may need a pane limit or renderer fallback.
- Keychain access prompts for Claude credentials on first run.
- Usage endpoint (`/oauth/usage`) is undocumented and can change.

## Decisions
- Name: AureliaSpace, Aurelia branding.
- Suggestions use free backends only (Ollama default); no paid API.
- Agent status comes from Claude Code hooks only.
