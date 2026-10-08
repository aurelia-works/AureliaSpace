import { create } from "zustand";
import { basename } from "../lib/format";
import { useAgents } from "../store/agents";
import { useLayout, type DropZone } from "../store/layout";

/**
 * Drag a pane by its header onto another pane in the same tab: drop on an edge to dock it
 * there, in the middle to swap the two. Pointer events rather than HTML5 drag-and-drop,
 * because Tauri's native file-drop handler swallows HTML5 drag events on macOS.
 */
interface DragState {
  paneId: string | null;
  target: string | null;
  zone: DropZone | null;
  x: number;
  y: number;
}

export const usePaneDrag = create<DragState>(() => ({ paneId: null, target: null, zone: null, x: 0, y: 0 }));

/** Edge bands are the outer quarter of the pane; the middle swaps. */
function zoneAt(r: DOMRect, x: number, y: number): DropZone {
  const fx = (x - r.left) / r.width;
  const fy = (y - r.top) / r.height;
  const edges: [DropZone, number][] = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ];
  const [zone, d] = edges.reduce((best, e) => (e[1] < best[1] ? e : best));
  return d < 0.25 ? zone : "center";
}

const START_DISTANCE = 5;

/** Header pointerdown: becomes a drag once the pointer travels a few pixels, else stays a click. */
export function startPaneDrag(e: React.PointerEvent, paneId: string) {
  if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, [role=button], .account-switch")) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let active = false;

  const move = (ev: PointerEvent) => {
    if (!active) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < START_DISTANCE) return;
      active = true;
      document.body.classList.add("pane-dragging");
    }
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-pane-id]");
    const target = el?.dataset.paneId;
    const sameTab = target && target !== paneId && el.closest(".tab-content") === document.querySelector(`[data-pane-id="${paneId}"]`)?.closest(".tab-content");
    usePaneDrag.setState({
      paneId,
      target: sameTab ? target : null,
      zone: sameTab ? zoneAt(el.getBoundingClientRect(), ev.clientX, ev.clientY) : null,
      x: ev.clientX,
      y: ev.clientY,
    });
  };
  const end = (drop: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, true);
    document.body.classList.remove("pane-dragging");
    const { target, zone } = usePaneDrag.getState();
    usePaneDrag.setState({ paneId: null, target: null, zone: null });
    if (drop && active && target && zone) useLayout.getState().movePane(paneId, target, zone);
  };
  const up = () => end(true);
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    end(false);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key, true);
}

/** The highlight on the pane under the pointer, showing where the dragged pane will land. */
export function DropIndicator({ paneId }: { paneId: string }) {
  const zone = usePaneDrag((s) => (s.target === paneId ? s.zone : null));
  if (!zone) return null;
  return <div className={`drop-zone ${zone}`}>{zone === "center" ? "Swap" : "Move here"}</div>;
}

/** A small label that follows the pointer while dragging. */
export function PaneDragGhost() {
  const paneId = usePaneDrag((s) => s.paneId);
  const x = usePaneDrag((s) => s.x);
  const y = usePaneDrag((s) => s.y);
  const label = useAgents((s) => (paneId ? s.sessions[paneId]?.account : undefined));
  const cwd = useLayout((s) => (paneId ? s.panes[paneId]?.cwd : undefined));
  if (!paneId) return null;
  return (
    <div className="pane-ghost" style={{ transform: `translate(${x + 12}px, ${y + 12}px)` }}>
      {basename(cwd) || "~"}
      {label && <span className="account-chip">{label}</span>}
    </div>
  );
}
