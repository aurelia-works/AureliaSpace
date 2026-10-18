import { ipc } from "./ipc";

/**
 * Snapshots the pane's repo before each prompt (src-tauri/src/checkpoints.rs). Runs in the
 * background; a folder outside git, or a tree unchanged since the last one, adds nothing.
 */
export function takeCheckpoint(paneId: string, cwd: string, prompt?: string) {
  ipc.checkpointCreate(cwd, paneId, prompt?.trim() || "Prompt").catch(() => {});
}
