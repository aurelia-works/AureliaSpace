import { useRef } from "react";
import { paneIds, useLayout, type LayoutNode } from "../store/layout";
import { PaneView } from "./PaneView";

/**
 * A tab's panes. With `zoom` set, only that pane shows, full size; the others stay mounted
 * (hidden) so their terminals keep running and come back as they were.
 */
export function LayoutView({ node, zoom }: { node: LayoutNode; zoom?: string }) {
  if (node.type === "pane") return <PaneView paneId={node.id} />;
  return <Split node={node} zoom={zoom} />;
}

function Split({ node, zoom }: { node: Extract<LayoutNode, { type: "split" }>; zoom?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const setRatio = useLayout((s) => s.setRatio);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    document.body.classList.add("resizing", node.dir === "row" ? "resizing-row" : "resizing-col");
    const move = (ev: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const ratio = node.dir === "row" ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      setRatio(node.id, ratio);
    };
    const up = () => {
      document.body.classList.remove("resizing", "resizing-row", "resizing-col");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const side = zoom ? (paneIds(node.a).includes(zoom) ? "a" : paneIds(node.b).includes(zoom) ? "b" : undefined) : undefined;
  return (
    <div ref={ref} className={`split split-${node.dir}`}>
      <div className={`split-child${side === "b" ? " zoom-hidden" : ""}`} style={{ flex: side ? "1 1 0" : `${node.ratio} 1 0` }}>
        <LayoutView node={node.a} zoom={zoom} />
      </div>
      {!side && (
        <div
          className="divider"
          onMouseDown={onMouseDown}
          onDoubleClick={() => setRatio(node.id, 0.5)}
          title="Drag to resize · double-click to even out"
        />
      )}
      <div className={`split-child${side === "a" ? " zoom-hidden" : ""}`} style={{ flex: side ? "1 1 0" : `${1 - node.ratio} 1 0` }}>
        <LayoutView node={node.b} zoom={zoom} />
      </div>
    </div>
  );
}
