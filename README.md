# AureliaSpace

Personal macOS terminal (Tauri 2 + React + xterm.js) for running several Claude Code
accounts side by side. See `PRD.md` for scope.

## Run

```sh
npm install
npm run app:dev     # dev window with hot reload
npm run app:build   # → src-tauri/target/release/bundle/macos/AureliaSpace.app
```

## Shortcuts

| Keys | Action |
| --- | --- |
| ⌘T | New tab (same cwd) |
| ⌘D / ⇧⌘D | Split right / down |
| ⌘W / ⇧⌘W | Close pane / tab |
| ⌥⌘ arrows | Focus pane in that direction |
| ⌘1…9, ⇧⌘[ ] | Switch tab |
| ⌘E / ⇧⌘E | New Claude pane as an account (split / tab) |
| ⌘G | New grid tab (2, 4, 6, 9, 12 or 16 panes) |
| ⌘J | Jump to the agent waiting on you longest |
| ⇧⌘R | Review uncommitted changes, send line comments to Claude |
| ⇧⌘F | Files sidebar |
| ⌘-click | Open a URL, or a `path:line:col` in output in your editor |
| ⌘I | Command suggestion (inserted at the prompt, never run) |
| ⌘B | Agent panel |
| ⇧⌘↑ / ⇧⌘↓ | Jump to previous / next command block |
| ⌘K | Clear |
| ⌘+ ⌘- ⌘0 | Font size |
| ⌘, | Settings |

## How it works

- **PTY**: `src-tauri/src/pty.rs`, one `portable-pty` per pane. Output reaches the
  frontend as raw bytes over a Tauri channel, batched in 3 ms windows.
- **Command blocks**: zsh starts with `ZDOTDIR` pointing at a tiny bootstrap that
  restores your own `ZDOTDIR`, sources your `.zshenv`, then loads
  `resources/integration.zsh`. That file emits OSC 133 A/C/D plus `OSC 6973` (command
  text and cwd, base64). `src/lib/blocks.ts` turns these into blocks.
  `BlockOverlay.tsx` draws the gutter, the failed-command tint, and the hover toolbar
  (copy command, copy output, rerun). Alt-screen apps and non-zsh shells get a plain
  terminal. Click a block's gutter to select its text.
- **Accounts**: defined in `~/Library/Application Support/AureliaSpace/config.json`
  (auto-detected from `~/.claude*` on first run). A pane launched as an account gets
  `CLAUDE_CONFIG_DIR` (left unset for `~/.claude`) and runs `claude`. Usage comes from
  running your existing `~/.claude/fetch-usage.sh` and reading its
  `/tmp/.claude_usage_cache_*` file. The app never reads credentials itself.
  Accounts are only ever chosen manually.
- **Agent panel**: inside panes, `claude` is a shell function that adds
  `--settings …/hooks/claude-settings.json`. Those hooks (SessionStart,
  UserPromptSubmit, Pre/PostToolUse, Notification, Stop, SessionEnd) append one JSON
  line to `run/agent-events.jsonl`, which the app tails. Background panes send a macOS
  notification when Claude finishes or needs input. Tasks are stored per git root in
  `tasks.json`, and the pin button attaches a task to the focused pane.
- **Links**: `src/lib/links.ts`. URLs and file references in output are underlined;
  ⌘-click opens them. Candidate paths are checked for existence (`files.rs`) relative
  to the pane's cwd (Claude's own cwd in agent panes). Files open in the `editor`
  config command, else Cursor, else VS Code, else the default app.
- **File drops**: dropping files on a pane types their escaped paths at its prompt
  (`src/lib/filedrop.ts`); Tauri's native drop handler would otherwise swallow them.
- **Git**: `git.rs` reads branch/worktree info straight from `.git` (no process per
  poll), shown in pane headers and agent rows. "Own git worktree" (account picker,
  grid picker) runs `git worktree add -b aurelia/<name>` into
  `<repo>.worktrees/<name>` next to the repo. Worktrees are never removed
  automatically; clean up with `git worktree remove`.
- **Review**: ⇧⌘R shows `git diff HEAD` plus untracked files; comments are pasted into
  the chosen Claude pane as one message and submitted.
- **Tasks**: the ▶ button on a task opens the account picker and starts
  `claude '<task>'` in a new pane, attaching the task and marking it doing.
- **Suggestions**: `src-tauri/src/suggest.rs`. Ollama (default,
  `qwen2.5-coder:1.5b`), Gemini or OpenRouter free tiers; keys live in the Keychain
  (service `AureliaSpace`). Sends cwd, shell, and the last 5 commands. The last
  command's output is sent only when "last output" is ticked.
- **State**: `layout.json` (tabs, splits, cwd and account per pane), `tasks.json`,
  `ui.json`, all in the app support dir.

## Setup for suggestions

```sh
brew install ollama && ollama serve &
ollama pull qwen2.5-coder:1.5b
```
