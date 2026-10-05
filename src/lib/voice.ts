import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { useAgents } from "../store/agents";
import { getConfig } from "../store/config";
import { focusedPaneId, useLayout } from "../store/layout";
import { useUi } from "../store/ui";
import { ipc } from "./ipc";
import { insertAtPrompt } from "./terminals";

export type VoiceState = "idle" | "listening" | "transcribing" | "error";

interface VoiceStore {
  /** Aurelia Voice is installed, so the mic button is shown. */
  installed: boolean;
  state: VoiceState;
}

export const useVoice = create<VoiceStore>(() => ({ installed: false, state: "idle" }));

/** Spoken "dash dash" / "dash" become flags, and the sentence-ending period is dropped. */
export function cleanShellText(text: string): string {
  return text
    .trim()
    .replace(/(^|\s)dash\s+dash\s+(?=\S)/gi, "$1--")
    .replace(/(^|\s)dash\s+(?=\S)/gi, "$1-")
    .replace(/(?<!\.)\.$/, "");
}

function isClaudePane(paneId: string) {
  return !!useAgents.getState().sessions[paneId] || !!useLayout.getState().panes[paneId]?.account;
}

/** Types a dictated transcript at the focused pane's prompt. Never presses Enter. */
function deliver(text: string) {
  const paneId = focusedPaneId();
  if (!paneId || !text.trim()) return;
  const out = !isClaudePane(paneId) && getConfig().voice?.shellCleanup ? cleanShellText(text) : text;
  insertAtPrompt(paneId, out);
}

/** Focuses the pane, then starts or stops a dictation in Aurelia Voice. */
export function toggleVoice(paneId?: string) {
  if (!useVoice.getState().installed) return;
  if (paneId) useLayout.getState().focusPane(paneId);
  ipc.voiceToggle().catch((e) => useUi.getState().set({ toast: { text: `Aurelia Voice: ${e}`, error: true, at: Date.now() } }));
}

export async function startVoice() {
  ipc.voiceInstalled().then((installed) => useVoice.setState({ installed })).catch(() => {});
  await listen<{ text?: string }>("voice-transcript", (e) => deliver(e.payload.text ?? ""));
  await listen<{ state?: VoiceState }>("voice-state", (e) => useVoice.setState({ state: e.payload.state ?? "idle" }));
  // The app may have been installed while we were running.
  window.addEventListener("focus", () => ipc.voiceInstalled().then((installed) => useVoice.setState({ installed })).catch(() => {}));
}
