import type { ChatImage } from "./ipc";

/**
 * The chat composers' text, reachable from outside React: dictation, the files panel, file
 * drops and the review panel type into a chat here, as they type at a terminal's prompt.
 * A chat that isn't on screen gets the text in its draft, shown when it mounts.
 */

/** Unsent text and images per chat, so switching tabs or panes keeps them. */
export const drafts = new Map<string, { text: string; images: ChatImage[] }>();

interface Handle {
  insert(text: string): void;
  focus(): void;
}

const mounted = new Map<string, Handle>();

export function registerComposer(paneId: string, h: Handle) {
  mounted.set(paneId, h);
  return () => {
    if (mounted.get(paneId) === h) mounted.delete(paneId);
  };
}

/** `add` after `cur`, with a space between unless `cur` already ends in one. */
export const appendText = (cur: string, add: string) => (cur && !/\s$/.test(cur) ? `${cur} ` : cur) + add;

export function insertIntoChat(paneId: string, text: string) {
  const h = mounted.get(paneId);
  if (h) return h.insert(text);
  const d = drafts.get(paneId) ?? { text: "", images: [] };
  drafts.set(paneId, { ...d, text: appendText(d.text, text) });
}

export function focusChat(paneId: string) {
  mounted.get(paneId)?.focus();
}
