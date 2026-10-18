import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { RemotePane, Snapshot } from "../remote/Remote";
import { visualOf } from "../components/StatusGlyph";
import { paneTitle } from "../components/TitleBar";
import { useAgents, type AgentSession } from "../store/agents";
import { useConfig } from "../store/config";
import { useNotices } from "../store/notifications";
import { customAgentById, useCustomAgents } from "../store/customAgents";
import { paneIds, useLayout } from "../store/layout";
import { useRecents } from "../store/recents";
import { useRuntime } from "../store/runtime";
import { basename } from "./format";
import { ipc } from "./ipc";
import { answerPermission, permissionOptions, type PermissionChoice } from "./permissions";
import { riskOf } from "./risk";

/** Phones connected to the remote (src-tauri/src/remote.rs), for the status bar. */
export const useRemote = create<{ clients: number }>(() => ({ clients: 0 }));

let created: Snapshot["created"];

/** What a permission request is about, so an answer can be matched to the request it was for. */
const askKey = (s: AgentSession) => `${s.tool ?? ""}\u0000${s.toolInput?.command ?? s.toolInput?.file_path ?? s.toolInput?.url ?? ""}\u0000${s.message ?? ""}`;

/** Read off the screen, so only a dialog that is really showing gets buttons on the phone. */
function permissionFor(s: AgentSession): RemotePane["permission"] {
  const opts = s.status === "needs_input" ? permissionOptions(s.paneId) : null;
  if (!opts) return undefined;
  const what = s.toolInput?.command ?? s.toolInput?.file_path ?? s.toolInput?.url;
  return { always: opts.always, tool: s.tool, what, risk: riskOf(s.tool, s.toolInput, s.cwd)?.why, key: askKey(s) };
}

function snapshot(): Snapshot {
  const { tabs, panes } = useLayout.getState();
  const sessions = useAgents.getState().sessions;
  const runtime = useRuntime.getState().panes;
  const list: RemotePane[] = tabs.flatMap((tab, i) =>
    paneIds(tab.root).flatMap((id) => {
      const pane = panes[id];
      // Terminals only: browser, editor and start-screen panes have nothing to drive.
      if (!pane || pane.browser || pane.editor || pane.launcher) return [];
      const s = sessions[id];
      const cwd = s?.cwd ?? pane.cwd;
      const title = customAgentById(pane.customAgent)?.name ?? pane.agent?.split(":")[0] ?? (pane.account || s ? "claude" : paneTitle(cwd, runtime[id]?.running));
      return [
        {
          id,
          title,
          where: basename(cwd) || undefined,
          account: s?.account ?? pane.account,
          tab: i + 1,
          status: s ? visualOf(s) : "shell",
          message: s?.status === "needs_input" ? s.message : s?.status === "working" && s.tool ? `running ${s.tool}` : undefined,
          permission: s ? permissionFor(s) : undefined,
        },
      ];
    }),
  );
  const folders = [...new Set([...list.map((p) => sessions[p.id]?.cwd ?? panes[p.id]?.cwd), ...useRecents.getState().folders].filter((f): f is string => !!f))];
  return {
    panes: list,
    accounts: useConfig.getState().config?.accounts.map((a) => a.name) ?? [],
    projects: folders.slice(0, 10).map((path) => ({ name: basename(path) || path, path })),
    created,
  };
}

function push() {
  if (!useConfig.getState().config?.remote?.enabled) return;
  ipc.remoteSnapshot(snapshot()).catch(() => {});
}

type Action =
  | { kind: "new"; account: string | null; cwd: string | null; nonce: string }
  | { kind: "close"; pane: string }
  | { kind: "permission"; pane: string; choice: PermissionChoice; key: string };

const CHOICES: PermissionChoice[] = ["allow", "always", "deny"];

/** Keeps the phone's pane list current and runs what it asks for. */
export async function startRemote() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let late: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(push, 250);
  };
  useLayout.subscribe(soon);
  useAgents.subscribe(() => {
    soon();
    // A permission dialog draws a moment after its hook event; look again once it's up.
    clearTimeout(late);
    late = setTimeout(push, 700);
  });
  useRuntime.subscribe((s, prev) => s.panes !== prev.panes && soon());
  useCustomAgents.subscribe(soon);
  useConfig.subscribe(soon);
  push();

  await listen<number>("remote-clients", (e) => useRemote.setState({ clients: e.payload }));
  await listen<Action>("remote-action", (e) => {
    const a = e.payload;
    const layout = useLayout.getState();
    if (a.kind === "new") {
      const pane = layout.newTab({ account: a.account ?? undefined, cwd: a.cwd ?? undefined });
      created = { nonce: a.nonce, pane };
      push();
    } else if (a.kind === "close" && layout.panes[a.pane]) {
      layout.closePane(a.pane);
    } else if (a.kind === "permission" && CHOICES.includes(a.choice)) {
      // Only if the pane still asks exactly what the phone showed: a tap on a stale list
      // must never answer a newer request. Otherwise the phone just gets a fresh list.
      const s = useAgents.getState().sessions[a.pane];
      if (s && askKey(s) === a.key && answerPermission(a.pane, a.choice)) useNotices.getState().resolvePane(a.pane, ["permission", "needs_input"]);
      soon();
    }
  });
}
