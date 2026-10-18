import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { visualOf } from "../components/StatusGlyph";
import { paneTitle } from "../components/TitleBar";
import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { paneIds, useLayout } from "../store/layout";
import { useRuntime } from "../store/runtime";
import { openInBrowserPane } from "./browser";
import { sendPrompt } from "./effort";
import { expandPath } from "./format";
import { shellQuote } from "./launch";
import { enqueue } from "./outbox";
import { getEntry, queueInit, submitToPane } from "./terminals";

/**
 * Answers the `aurelia_*` tools Claude panes call (src-tauri/src/control.rs): list, read
 * and message panes, open Claude panes, and show an HTML page in a browser pane.
 */
interface Request {
  id: number;
  method: string;
  params: Record<string, unknown>;
  /** The calling pane (AURELIA_PANE_ID), when known. */
  from: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

function listPanes(from: string) {
  const { tabs, panes } = useLayout.getState();
  const sessions = useAgents.getState().sessions;
  const runtime = useRuntime.getState().panes;
  return tabs.flatMap((tab, i) =>
    paneIds(tab.root).flatMap((id) => {
      const pane = panes[id];
      if (!pane || pane.browser || pane.editor || pane.launcher) return [];
      const s = sessions[id];
      const cwd = s?.cwd ?? pane.cwd;
      return [
        {
          id,
          self: id === from || undefined,
          title: s ? "claude" : paneTitle(cwd, runtime[id]?.running),
          cwd,
          account: s?.account ?? pane.account,
          status: s ? visualOf(s) : "shell",
          waitingOn: s?.status === "needs_input" ? s.message : undefined,
          tab: i + 1,
        },
      ];
    }),
  );
}

function readPane(paneId: string, lines: number): string {
  const term = getEntry(paneId)?.term;
  if (!term) throw new Error(`no terminal pane ${paneId}`);
  const buf = term.buffer.active;
  const end = Math.min(buf.length, buf.baseY + term.rows);
  const out: string[] = [];
  for (let i = Math.max(0, end - lines); i < end; i++) out.push(buf.getLine(i)?.translateToString(true) ?? "");
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join("\n");
}

async function sendToPane(from: string, paneId: string, text: string): Promise<string> {
  const pane = useLayout.getState().panes[paneId];
  if (!pane || pane.browser || pane.editor || pane.launcher) throw new Error(`no terminal pane ${paneId}`);
  if (paneId === from) throw new Error("that is your own pane");
  if (!text.trim()) throw new Error("text is empty");
  const s = useAgents.getState().sessions[paneId];
  // A permission prompt or question is for the human: typing into it could answer it.
  if (s?.status === "needs_input") throw new Error("that pane is waiting on its human; try again after they answer");
  if (s && (s.status === "working" || s.status === "starting")) {
    enqueue(paneId, text);
    return "queued: it goes in when that agent finishes its turn";
  }
  const { sent } = s ? await sendPrompt(paneId, text) : { sent: submitToPane(paneId, text) };
  if (!sent) throw new Error("that pane isn't running");
  return "sent";
}

function openPane(from: string, params: Record<string, unknown>): string {
  const layout = useLayout.getState();
  const caller = layout.panes[from];
  const accounts = useConfig.getState().config?.accounts.map((a) => a.name) ?? [];
  const account = accounts.includes(str(params.account)) ? str(params.account) : (caller?.account ?? useAgents.getState().sessions[from]?.account);
  const cwd = str(params.cwd) ? expandPath(str(params.cwd)) : (useAgents.getState().sessions[from]?.cwd ?? caller?.cwd);
  const prompt = str(params.prompt).trim();
  if (!prompt) throw new Error("prompt is required");
  const opts = { account: account || undefined, cwd };
  const id = caller ? layout.splitPane(from, "row", opts) : layout.newTab(opts);
  queueInit(id, `claude ${shellQuote(prompt)}`);
  return id;
}

async function answer(req: Request): Promise<unknown> {
  const p = req.params ?? {};
  switch (req.method) {
    case "list_panes":
      return listPanes(req.from);
    case "read_pane":
      return readPane(str(p.pane), Math.min(400, Math.max(5, Number(p.lines) || 80)));
    case "send_to_pane":
      return sendToPane(req.from, str(p.pane), str(p.text));
    case "open_pane":
      return { pane: openPane(req.from, p) };
    case "open_url":
      return { pane: openInBrowserPane(useLayout.getState().panes[req.from] ? req.from : undefined, str(p.url)), url: str(p.url) };
    default:
      throw new Error(`unknown method ${req.method}`);
  }
}

export async function startControl() {
  await listen<Request>("control-request", async (e) => {
    const req = e.payload;
    let reply: unknown;
    try {
      reply = { result: await answer(req) };
    } catch (err) {
      reply = { error: err instanceof Error ? err.message : String(err) };
    }
    invoke("control_reply", { id: req.id, reply }).catch(() => {});
  });
}
