import { useLayoutEffect, useRef } from "react";
import { attachTerminal, ensureTerminal, fitTerminal } from "../lib/terminals";
import { useLayout } from "../store/layout";
import { useUi } from "../store/ui";
import { BlockOverlay } from "./BlockOverlay";
import { PaneHeader } from "./PaneHeader";
import { SuggestBar } from "./SuggestBar";

export function PaneView({ paneId }: { paneId: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const exists = useLayout((s) => !!s.panes[paneId]);
  const focused = useLayout((s) => s.tabs.some((t) => t.focusedPaneId === paneId));
  const multi = useLayout((s) => s.tabs.some((t) => t.focusedPaneId === paneId && t.root.type === "split"));
  const suggestOpen = useUi((s) => s.suggestPaneId === paneId);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    const pane = useLayout.getState().panes[paneId];
    if (!el || !pane) return;
    ensureTerminal(pane);
    attachTerminal(paneId, el);
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitTerminal(paneId));
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [paneId]);

  if (!exists) return null;

  return (
    <div
      className={`pane${focused ? " focused" : ""}${focused && multi ? " focus-ring" : ""}`}
      data-pane-id={paneId}
      onMouseDownCapture={() => useLayout.getState().focusPane(paneId)}
    >
      <PaneHeader paneId={paneId} />
      <div className="pane-body">
        <div className="term-container" ref={bodyRef} />
        <BlockOverlay paneId={paneId} />
        {suggestOpen && <SuggestBar paneId={paneId} />}
      </div>
    </div>
  );
}
