/**
 * `--permission-mode` for a new Claude pane from the Settings value. Empty (never chosen)
 * means Auto-edit; "default" is Claude's own ask-before-edits mode, which passes no flag.
 */
export function startPermissionMode(setting: string | undefined): string | undefined {
  const mode = setting || "acceptEdits";
  return mode === "default" ? undefined : mode;
}
