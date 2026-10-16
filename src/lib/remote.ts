import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { RemotePane, Snapshot } from "../remote/Remote";
import { visualOf } from "../components/StatusGlyph";
import { paneTitle } from "../components/TitleBar";
import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { customAgentById, useCustomAgents } from "../store/customAgents";
import { paneIds, useLayout } from "../store/layout";
import { useRecents } from "../store/recents";
import { useRuntime } from "../store/runtime";
import { basename } from "./format";
import { ipc } from "./ipc";

/** Phones connected to the remote (src-tauri/src/remote.rs), for the status bar. */
export const useRemote = create<{ clients: number }>(() => ({ clients: 0 }));

let created: Snapshot["created"];

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

type Action = { kind: "new"; account: string | null; cwd: string | null; nonce: string } | { kind: "close"; pane: string };

/** Keeps the phone's pane list current and runs what it asks for. */
export async function startRemote() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(push, 250);
  };
  useLayout.subscribe(soon);
  useAgents.subscribe(soon);
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
    }
  });
}
