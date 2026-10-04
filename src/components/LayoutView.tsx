import { useRef } from "react";
import { useLayout, type LayoutNode } from "../store/layout";
import { PaneView } from "./PaneView";

export function LayoutView({ node }: { node: LayoutNode }) {
  if (node.type === "pane") return <PaneView paneId={node.id} />;
  return <Split node={node} />;
}

function Split({ node }: { node: Extract<LayoutNode, { type: "split" }> }) {
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

  return (
    <div ref={ref} className={`split split-${node.dir}`}>
      <div className="split-child" style={{ flex: `${node.ratio} 1 0` }}>
        <LayoutView node={node.a} />
      </div>
      <div
        className="divider"
        onMouseDown={onMouseDown}
        onDoubleClick={() => setRatio(node.id, 0.5)}
        title="Drag to resize · double-click to even out"
      />
      <div className="split-child" style={{ flex: `${1 - node.ratio} 1 0` }}>
        <LayoutView node={node.b} />
      </div>
    </div>
  );
}
