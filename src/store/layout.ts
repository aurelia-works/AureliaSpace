import { create } from "zustand";

export type SplitDir = "row" | "column"; // row = side by side, column = stacked

/** Where a dragged pane lands on another: beside it on one edge, or swapped into its place. */
export type DropZone = "left" | "right" | "top" | "bottom" | "center";

export type LayoutNode =
  | { type: "pane"; id: string }
  | { type: "split"; id: string; dir: SplitDir; ratio: number; a: LayoutNode; b: LayoutNode };

export interface PaneMeta {
  id: string;
  /** Claude account this pane was launched as (runs `claude` on start). */
  account?: string;
  cwd?: string;
  /** Agent launcher variant this pane runs (e.g. "codex:oss"); informational. */
  agent?: string;
  /** Env for the agent CLI; secrets are referenced by Keychain id, never stored here. */
  env?: Record<string, string>;
  secretEnv?: Record<string, string>;
  /** Saved custom agent (store/customAgents) this pane was launched as: its name and colour label the pane. */
  customAgent?: string;
  /** Shows the start screen instead of a terminal until the user picks what to run. */
  launcher?: boolean;
  /** A built-in browser pane (native child webview) instead of a terminal; url "" = blank. */
  browser?: { url: string };
}

export interface Tab {
  id: string;
  root: LayoutNode;
  focusedPaneId: string;
}

export interface NewPaneOpts {
  account?: string;
  cwd?: string;
  agent?: string;
  env?: Record<string, string>;
  secretEnv?: Record<string, string>;
  customAgent?: string;
  launcher?: boolean;
  /** Opens a browser pane at this URL ("" = blank) instead of a terminal. */
  browserUrl?: string;
}

interface LayoutState {
  tabs: Tab[];
  activeTabId: string;
  panes: Record<string, PaneMeta>;
  hydrated: boolean;

  newTab(opts?: NewPaneOpts): string;
  /** Opens a tab with `rows` × `cols` evenly sized panes; returns their ids in reading order. */
  newGridTab(rows: number, cols: number, opts: NewPaneOpts[]): string[];
  /** Opens a tab with exactly `opts.length` panes in a near-square grid (last row may be shorter). */
  newPanesTab(opts: NewPaneOpts[]): string[];
  closeTab(tabId: string): void;
  activateTab(tabId: string): void;
  activateTabIndex(index: number): void;
  cycleTab(delta: number): void;
  splitPane(paneId: string, dir: SplitDir, opts?: NewPaneOpts): string;
  closePane(paneId: string): void;
  /** Moves a pane next to another in the same tab ("center" swaps the two). */
  movePane(paneId: string, targetId: string, zone: DropZone): void;
  focusPane(paneId: string): void;
  setRatio(splitId: string, ratio: number): void;
  updatePane(paneId: string, patch: Partial<PaneMeta>): void;
  hydrate(saved: SavedLayout | null): void;
}

export interface SavedLayout {
  version: 1;
  tabs: Tab[];
  activeTabId: string;
  panes: Record<string, PaneMeta>;
}

let counter = 0;
export const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function paneIds(node: LayoutNode): string[] {
  return node.type === "pane" ? [node.id] : [...paneIds(node.a), ...paneIds(node.b)];
}

function replaceNode(node: LayoutNode, id: string, fn: (n: LayoutNode) => LayoutNode | null): LayoutNode | null {
  if (node.id === id) return fn(node);
  if (node.type === "pane") return node;
  const a = replaceNode(node.a, id, fn);
  const b = replaceNode(node.b, id, fn);
  if (!a) return b;
  if (!b) return a;
  if (a === node.a && b === node.b) return node;
  return { ...node, a, b };
}

export function tabOfPane(tabs: Tab[], paneId: string): Tab | undefined {
  return tabs.find((t) => paneIds(t.root).includes(paneId));
}

/** Panes that were closed and need their terminal/PTY torn down (handled by the registry). */
type CloseListener = (paneIds: string[]) => void;
const closeListeners = new Set<CloseListener>();
export function onPanesClosed(fn: CloseListener) {
  closeListeners.add(fn);
  return () => closeListeners.delete(fn);
}
const emitClosed = (ids: string[]) => ids.length && closeListeners.forEach((fn) => fn(ids));

function makePane(opts?: NewPaneOpts): PaneMeta {
  return {
    id: uid("pane"),
    account: opts?.account,
    cwd: opts?.cwd,
    agent: opts?.agent,
    env: opts?.env,
    secretEnv: opts?.secretEnv,
    customAgent: opts?.customAgent,
    launcher: opts?.launcher || undefined,
    browser: opts?.browserUrl !== undefined ? { url: opts.browserUrl } : undefined,
  };
}

/** Balanced binary splits whose ratios give every leaf the same share of space. */
function evenSplit(nodes: LayoutNode[], dir: SplitDir): LayoutNode {
  if (nodes.length === 1) return nodes[0];
  const mid = Math.ceil(nodes.length / 2);
  return {
    type: "split",
    id: uid("split"),
    dir,
    ratio: mid / nodes.length,
    a: evenSplit(nodes.slice(0, mid), dir),
    b: evenSplit(nodes.slice(mid), dir),
  };
}

function makeTab(pane: PaneMeta): Tab {
  return { id: uid("tab"), root: { type: "pane", id: pane.id }, focusedPaneId: pane.id };
}

export const useLayout = create<LayoutState>((set, get) => ({
  tabs: [],
  activeTabId: "",
  panes: {},
  hydrated: false,

  newTab(opts) {
    const pane = makePane(opts);
    const tab = makeTab(pane);
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, panes: { ...s.panes, [pane.id]: pane } }));
    return pane.id;
  },

  newGridTab(rows, cols, opts) {
    const created = Array.from({ length: rows * cols }, (_, i) => makePane(opts[i] ?? opts[0]));
    const rowNodes = Array.from({ length: rows }, (_, r) =>
      evenSplit(
        created.slice(r * cols, (r + 1) * cols).map((p) => ({ type: "pane", id: p.id }) as LayoutNode),
        "row",
      ),
    );
    const tab: Tab = { id: uid("tab"), root: evenSplit(rowNodes, "column"), focusedPaneId: created[0].id };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      panes: { ...s.panes, ...Object.fromEntries(created.map((p) => [p.id, p])) },
    }));
    return created.map((p) => p.id);
  },

  newPanesTab(opts) {
    const created = opts.map((o) => makePane(o));
    const cols = Math.ceil(Math.sqrt(created.length));
    const rowNodes: LayoutNode[] = [];
    for (let i = 0; i < created.length; i += cols) {
      rowNodes.push(evenSplit(created.slice(i, i + cols).map((p) => ({ type: "pane", id: p.id }) as LayoutNode), "row"));
    }
    const tab: Tab = { id: uid("tab"), root: evenSplit(rowNodes, "column"), focusedPaneId: created[0].id };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      panes: { ...s.panes, ...Object.fromEntries(created.map((p) => [p.id, p])) },
    }));
    return created.map((p) => p.id);
  },

  closeTab(tabId) {
    const s = get();
    const idx = s.tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    const closed = paneIds(s.tabs[idx].root);
    const tabs = s.tabs.filter((t) => t.id !== tabId);
    const panes = { ...s.panes };
    closed.forEach((id) => delete panes[id]);
    let activeTabId = s.activeTabId;
    if (activeTabId === tabId) activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? "";
    set({ tabs, panes, activeTabId });
    emitClosed(closed);
    if (tabs.length === 0) get().newTab({ launcher: true });
  },

  activateTab(tabId) {
    if (get().tabs.some((t) => t.id === tabId)) set({ activeTabId: tabId });
  },

  activateTabIndex(index) {
    const tabs = get().tabs;
    const tab = index === -1 ? tabs[tabs.length - 1] : tabs[index];
    if (tab) set({ activeTabId: tab.id });
  },

  cycleTab(delta) {
    const { tabs, activeTabId } = get();
    const i = tabs.findIndex((t) => t.id === activeTabId);
    if (i < 0 || tabs.length < 2) return;
    set({ activeTabId: tabs[(i + delta + tabs.length) % tabs.length].id });
  },

  splitPane(paneId, dir, opts) {
    const s = get();
    const tab = tabOfPane(s.tabs, paneId);
    if (!tab) return get().newTab(opts);
    const inheritCwd = opts?.cwd ?? s.panes[paneId]?.cwd;
    const pane = makePane({ ...opts, cwd: inheritCwd });
    const root = replaceNode(tab.root, paneId, (n) => ({
      type: "split",
      id: uid("split"),
      dir,
      ratio: 0.5,
      a: n,
      b: { type: "pane", id: pane.id },
    }))!;
    set({
      tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root, focusedPaneId: pane.id } : t)),
      panes: { ...s.panes, [pane.id]: pane },
      activeTabId: tab.id,
    });
    return pane.id;
  },

  closePane(paneId) {
    const s = get();
    const tab = tabOfPane(s.tabs, paneId);
    if (!tab) return;
    if (tab.root.type === "pane") return get().closeTab(tab.id);
    const order = paneIds(tab.root);
    const root = replaceNode(tab.root, paneId, () => null)!;
    const remaining = paneIds(root);
    let focused = tab.focusedPaneId;
    if (focused === paneId) {
      // Prefer the pane just before the closed one in reading order.
      const i = order.indexOf(paneId);
      focused = i > 0 ? order[i - 1] : remaining[0];
    }
    const panes = { ...s.panes };
    delete panes[paneId];
    set({ tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root, focusedPaneId: focused } : t)), panes });
    emitClosed([paneId]);
  },

  movePane(paneId, targetId, zone) {
    const s = get();
    const tab = tabOfPane(s.tabs, paneId);
    if (!tab || paneId === targetId || tabOfPane(s.tabs, targetId) !== tab) return;
    let root: LayoutNode;
    if (zone === "center") {
      const swap = (n: LayoutNode): LayoutNode =>
        n.type === "split"
          ? { ...n, a: swap(n.a), b: swap(n.b) }
          : n.id === paneId
            ? { type: "pane", id: targetId }
            : n.id === targetId
              ? { type: "pane", id: paneId }
              : n;
      root = swap(tab.root);
    } else {
      // Lift the pane out (its sibling takes the parent's place), then split the target.
      const lifted = replaceNode(tab.root, paneId, () => null)!;
      const moved: LayoutNode = { type: "pane", id: paneId };
      const first = zone === "left" || zone === "top";
      root = replaceNode(lifted, targetId, (n) => ({
        type: "split",
        id: uid("split"),
        dir: zone === "left" || zone === "right" ? "row" : "column",
        ratio: 0.5,
        a: first ? moved : n,
        b: first ? n : moved,
      }))!;
    }
    set({ tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root, focusedPaneId: paneId } : t)) });
  },

  focusPane(paneId) {
    const s = get();
    const tab = tabOfPane(s.tabs, paneId);
    if (!tab) return;
    if (tab.focusedPaneId === paneId && s.activeTabId === tab.id) return;
    set({
      tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, focusedPaneId: paneId } : t)),
      activeTabId: tab.id,
    });
  },

  setRatio(splitId, ratio) {
    const r = Math.min(0.9, Math.max(0.1, ratio));
    set((s) => ({
      tabs: s.tabs.map((t) => {
        const root = replaceNode(t.root, splitId, (n) => (n.type === "split" ? { ...n, ratio: r } : n))!;
        return root === t.root ? t : { ...t, root };
      }),
    }));
  },

  updatePane(paneId, patch) {
    const pane = get().panes[paneId];
    if (!pane) return;
    const changed = Object.entries(patch).some(([k, v]) => pane[k as keyof PaneMeta] !== v);
    if (changed) set((s) => ({ panes: { ...s.panes, [paneId]: { ...pane, ...patch } } }));
  },

  hydrate(saved) {
    if (saved && saved.version === 1 && saved.tabs?.length) {
      // Drop panes that don't appear in any tab, and tabs that reference missing panes.
      const tabs = saved.tabs.filter((t) => paneIds(t.root).every((id) => saved.panes[id]));
      if (tabs.length) {
        const activeTabId = tabs.some((t) => t.id === saved.activeTabId) ? saved.activeTabId : tabs[0].id;
        set({ tabs, activeTabId, panes: saved.panes, hydrated: true });
        return;
      }
    }
    set({ hydrated: true });
    get().newTab({ launcher: true });
  },
}));

export function serializeLayout(): SavedLayout {
  const { tabs, activeTabId, panes } = useLayout.getState();
  return { version: 1, tabs, activeTabId, panes };
}

export const activeTab = () => {
  const s = useLayout.getState();
  return s.tabs.find((t) => t.id === s.activeTabId);
};

export const focusedPaneId = () => activeTab()?.focusedPaneId;
