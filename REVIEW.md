# Reviewing AureliaSpace

## Output

- The first line is the count: `3 issues` or `No issues.` Nothing goes above it.
- Every finding cites `file:line` (for example `src/lib/chat.ts:226`), then says what goes wrong,
  with the input or state that triggers it. A finding without a location is not reported.
- Most severe first. Mark each as **bug**, **risk** or **cleanup**.

## Real failures here

- **Chat protocol.** Wrong handling of Claude Code `stream-json` or Codex `app-server` events:
  lost or doubled messages, approvals left unanswered, a turn that never ends, events from an
  old spawn applied to a new one (`spawns` tokens in `src/lib/chat.ts`).
- **IPC drift.** A call in `src/lib/ipc.ts` that does not match its `#[tauri::command]` in
  `src-tauri/` (name, argument names, return shape).
- **Losing work.** Removing a worktree with uncommitted changes, closing a pane without asking
  while an agent runs, saved layout or UI state (`ipc.saveState`/`loadState`) that no longer
  loads, or a chat that loses its session id across a restart.
- **Shell and secrets.** Unquoted text reaching a shell (`queueInit`, `shellQuote` in
  `src/lib/launch.ts`); secrets written anywhere but the Keychain (`secretEnv` holds ids only).
- **Leaks and loops.** Terminals, PTYs, listeners, intervals or `requestAnimationFrame` loops not
  cleaned up; babysit or chained wakes that can fire without a cap.
- **Broken UI.** A screen that renders wrong in the preview harness (see CLAUDE.md), lost
  keyboard focus, a control with no accessible name, motion that ignores reduced motion.
- **Failing gate.** Any command in CLAUDE.md → Verification that fails.

## Ignore

- Formatting, naming taste and comment wording.
- Light theme: only dark is supported.
- `design/` (mockups and the preview harness), unless it breaks `npm run build` or a screenshot check.
- Possible problems with no path to happen in this app (single user, local machine).
- Refactors nobody asked for. Suggest them in one line at the end, outside the count.
