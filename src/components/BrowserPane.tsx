import { listen } from "@tauri-apps/api/event";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ipc } from "../lib/ipc";
import { normalizeUrl } from "../lib/browser";
import { onPanesClosed, useLayout } from "../store/layout";
import { useUi } from "../store/ui";

// The native webview outlives React remounts (splitting re-parents panes); it's destroyed only when the pane closes.
onPanesClosed((ids) => ids.forEach((id) => ipc.browserClose(id).catch(() => {})));

interface NavEvent {
  pane: string;
  url: string;
  loading: boolean;
}

const QUICK = ["localhost:3000", "localhost:5173", "localhost:8080"];

export function BrowserPane({ paneId }: { paneId: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const storeUrl = useLayout((s) => s.panes[paneId]?.browser?.url ?? "");
  const visible = useLayout((s) => s.activeTabId === s.tabs.find((t) => t.root && hasPane(t.root, paneId))?.id);
  const covered = useUi((s) => s.mode !== "terminals" || s.settingsOpen || !!s.accountPicker || s.gridOpen || s.reviewOpen);
  const [draft, setDraft] = useState(storeUrl);
  const [loading, setLoading] = useState(false);
  const created = useRef(false);
  const current = useRef(""); // URL the webview is known to be showing
  const show = visible && !covered;

  const rectOf = () => {
    const r = bodyRef.current?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  };

  const go = (url: string) => {
    if (!url) return;
    current.current = url;
    const r = rectOf();
    if (!created.current && r) {
      created.current = true;
      ipc.browserOpen(paneId, url, r).then(() => ipc.browserVisible(paneId, show)).catch(() => (created.current = false));
    } else if (created.current) ipc.browserNavigate(paneId, url).catch(() => {});
  };

  // Navigation reported by the webview keeps the address bar and saved layout current.
  useEffect(() => {
    const un = listen<NavEvent>("browser-nav", (e) => {
      if (e.payload.pane !== paneId) return;
      current.current = e.payload.url;
      setLoading(e.payload.loading);
      setDraft(e.payload.url);
      useLayout.getState().updatePane(paneId, { browser: { url: e.payload.url } });
    });
    return () => void un.then((f) => f());
  }, [paneId]);

  // A URL set from outside (terminal link, restored layout) that the webview isn't showing yet.
  useEffect(() => {
    if (storeUrl && storeUrl !== current.current && show) go(storeUrl);
  }, [storeUrl, show]);

  // Track the placeholder's rect while visible; hide the native view otherwise (it floats above the DOM).
  useLayoutEffect(() => {
    if (!show) {
      if (created.current) ipc.browserVisible(paneId, false).catch(() => {});
      return;
    }
    let frame = 0;
    let last = "";
    const tick = () => {
      const r = rectOf();
      const key = r ? `${r.x}|${r.y}|${r.w}|${r.h}` : "";
      if (r && key !== last) {
        last = key;
        if (created.current) ipc.browserBounds(paneId, r).catch(() => {});
        else if (storeUrl || current.current) go(current.current || storeUrl);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    if (created.current) ipc.browserVisible(paneId, true).catch(() => {});
    return () => cancelAnimationFrame(frame);
  }, [paneId, show]);

  // Hide (not close) on unmount; closing happens in onPanesClosed.
  useEffect(() => () => void (created.current && ipc.browserVisible(paneId, false).catch(() => {})), [paneId]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = normalizeUrl(draft);
    if (!url) return;
    setDraft(url);
    useLayout.getState().updatePane(paneId, { browser: { url } });
    go(url);
  };
  const act = (a: "back" | "forward" | "reload") => created.current && ipc.browserAction(paneId, a).catch(() => {});
  const open = (url: string) => {
    const normalized = normalizeUrl(url);
    setDraft(normalized);
    useLayout.getState().updatePane(paneId, { browser: { url: normalized } });
    go(normalized);
  };

  return (
    <div className="browser-pane">
      <form className="browser-bar" onSubmit={submit}>
        <button type="button" className="icon-btn" title="Back" onClick={() => act("back")}>
          ‹
        </button>
        <button type="button" className="icon-btn" title="Forward" onClick={() => act("forward")}>
          ›
        </button>
        <button type="button" className="icon-btn" title="Reload" onClick={() => act("reload")}>
          {loading ? "…" : "⟳"}
        </button>
        <input
          className="browser-url"
          value={draft}
          placeholder="Enter a URL or search"
          spellCheck={false}
          autoFocus={!storeUrl}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        <button
          type="button"
          className="icon-btn"
          title="Open in external browser"
          disabled={!storeUrl}
          onClick={() => ipc.openUrl(storeUrl).catch(() => {})}
        >
          ↗
        </button>
      </form>
      <div className="browser-body" ref={bodyRef}>
        {!storeUrl && (
          <div className="browser-empty">
            <div>Preview a dev server or docs</div>
            <div className="browser-quick">
              {QUICK.map((q) => (
                <button key={q} type="button" onClick={() => open(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function hasPane(node: import("../store/layout").LayoutNode, id: string): boolean {
  return node.type === "pane" ? node.id === id : hasPane(node.a, id) || hasPane(node.b, id);
}
