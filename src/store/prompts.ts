import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { expandPath, shortenPath } from "../lib/format";
import { ipc } from "../lib/ipc";
import { parsePromptLink } from "../lib/promptLink";
import { templateFields } from "../lib/template";
import { showPane } from "../lib/terminals";
import { useConfig } from "./config";
import { focusedPaneId, uid, useLayout } from "./layout";
import { useNotices } from "./notifications";
import { toast, useUi } from "./ui";

/** A prompt kept for reuse: inserted into a pane's composer, never sent on its own. */
export interface SavedPrompt {
  id: string;
  title: string;
  text: string;
  createdAt: number;
}

interface PromptsState {
  saved: SavedPrompt[];
  save(text: string): void;
  remove(id: string): void;
}

/** First line, trimmed to fit a rail row. */
export function promptTitle(text: string) {
  const line = text.trim().split("\n")[0].trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

export const usePrompts = create<PromptsState>((set, get) => ({
  saved: [],
  save(text) {
    const t = text.trim();
    if (!t) return;
    if (get().saved.some((p) => p.text === t)) return toast("Already in your prompts");
    set((s) => ({ saved: [{ id: uid("prompt"), title: promptTitle(t), text: t, createdAt: Date.now() }, ...s.saved] }));
    toast("Saved to Prompts");
  },
  remove: (id) => set((s) => ({ saved: s.saved.filter((p) => p.id !== id) })),
}));

export async function loadPrompts() {
  const saved = await ipc.loadState<{ saved: SavedPrompt[] }>("prompts").catch(() => null);
  if (Array.isArray(saved?.saved)) usePrompts.setState({ saved: saved.saved });
  let timer: ReturnType<typeof setTimeout> | undefined;
  usePrompts.subscribe((s, prev) => {
    if (s.saved === prev.saved) return;
    clearTimeout(timer);
    timer = setTimeout(() => ipc.saveState("prompts", { saved: usePrompts.getState().saved }).catch(() => {}), 400);
  });
}

/**
 * Opens the pane's composer (⌘L) with `text` in it, for the user to edit and send. Used by
 * saved prompts and prompt links; nothing here ever submits.
 */
export function draftInPane(paneId: string, text: string): boolean {
  const pane = useLayout.getState().panes[paneId];
  if (!pane || pane.browser || pane.editor || pane.launcher) {
    toast("Drop it on a terminal or Claude pane", true);
    return false;
  }
  // Fields first: the fill-in dialog hands the result to openDraft.
  if (templateFields(text).length) useUi.getState().set({ promptFill: { paneId, text } });
  else openDraft(paneId, text);
  return true;
}

export function openDraft(paneId: string, text: string) {
  showPane(paneId);
  useUi.getState().set({ composerPaneId: paneId, composerDraft: { paneId, text } });
}

/** The focused pane if it can take a draft, else a new terminal tab. */
function draftHere(text: string) {
  const { panes, newTab } = useLayout.getState();
  const id = focusedPaneId();
  const pane = id ? panes[id] : undefined;
  const target = pane && !pane.browser && !pane.editor && !pane.launcher ? pane.id : newTab({});
  // A new pane's terminal mounts on the next frame.
  requestAnimationFrame(() => draftInPane(target, text));
}

/**
 * Handles a prompt link: the prompt always lands in a composer as a draft. A link that names
 * a folder or account would start a shell or Claude there, so that waits for a click.
 */
function openPromptLink(raw: string) {
  const link = parsePromptLink(raw);
  if (!link) return toast("That AureliaSpace link isn't a prompt link", true);
  const accounts = useConfig.getState().config?.accounts.map((a) => a.name) ?? [];
  const account = link.account && accounts.includes(link.account) ? link.account : undefined;
  if (link.account && !account) toast(`No account named ${link.account}: using the default`, true);
  const cwd = link.cwd ? expandPath(link.cwd) : undefined;
  if (!account && !cwd) return draftHere(link.prompt);
  useNotices.getState().push({
    kind: "info",
    key: "prompt-link",
    sticky: true,
    title: "Open this prompt link?",
    body: `${account ? `Claude as ${account}` : "A terminal"}${cwd ? ` in ${shortenPath(cwd)}` : ""}, with the draft “${promptTitle(link.prompt)}”. Nothing is sent until you press Enter.`,
    actions: [
      {
        label: "Open",
        tone: "primary",
        run: () => {
          const pane = useLayout.getState().newTab({ account, cwd });
          requestAnimationFrame(() => draftInPane(pane, link.prompt));
        },
      },
      { label: "Draft here", run: () => draftHere(link.prompt) },
    ],
  });
}

/** `aureliaspace://` links macOS hands the app (src-tauri/src/links.rs), including the one that launched it. */
export async function startPromptLinks() {
  const take = () => ipc.takePromptLinks().then((urls) => urls.forEach(openPromptLink), () => {});
  await listen("prompt-links", take);
  take();
}
