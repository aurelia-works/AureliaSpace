import { useEffect, useReducer, useState } from "react";
import type { Block } from "../lib/blocks";
import { formatDuration } from "../lib/format";
import { getEntry, writeToPane } from "../lib/terminals";
import { CopyIcon, RerunIcon, TerminalIcon } from "./Icons";

/**
 * Draws command-block chrome over a terminal: a status gutter per block, a separator,
 * a tint for failed commands, and a hover toolbar (copy command/output, rerun).
 * Hidden on the alternate screen (vim, less, htop…).
 */
export function BlockOverlay({ paneId }: { paneId: string }) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const entry = getEntry(paneId);
    if (!entry) return;
    const { term, tracker, host } = entry;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        redraw();
      });
    };
    const subs = [
      term.onRender(schedule),
      term.onScroll(schedule),
      term.onResize(schedule),
      term.buffer.onBufferChange(schedule),
    ];
    const unsub = tracker.subscribe(schedule);

    const onMove = (e: MouseEvent) => {
      const screen = host.querySelector(".xterm-screen");
      if (!screen) return;
      const r = screen.getBoundingClientRect();
      const rowH = r.height / term.rows;
      if (e.clientY < r.top || e.clientY > r.bottom) return;
      const line = term.buffer.active.viewportY + Math.floor((e.clientY - r.top) / rowH);
      const block = tracker.blockAtLine(line);
      setHoverId(block?.id ?? null);
    };
    const onLeave = (e: MouseEvent) => {
      // Moving onto the toolbar shouldn't hide it.
      if ((e.relatedTarget as Element | null)?.closest?.(".block-toolbar")) return;
      setHoverId(null);
    };
    host.addEventListener("mousemove", onMove);
    host.addEventListener("mouseleave", onLeave);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      subs.forEach((s) => s.dispose());
      unsub();
      host.removeEventListener("mousemove", onMove);
      host.removeEventListener("mouseleave", onLeave);
    };
  }, [paneId]);

  const entry = getEntry(paneId);
  if (!entry || !entry.opened) return null;
  const { term, tracker, host } = entry;
  const buf = term.buffer.active;
  if (buf.type !== "normal" || tracker.blocks.length === 0) return null;
  const screen = host.querySelector(".xterm-screen");
  if (!screen || term.rows === 0) return null;

  const hostRect = host.getBoundingClientRect();
  const sr = screen.getBoundingClientRect();
  const rowH = sr.height / term.rows;
  const top0 = sr.top - hostRect.top;
  const left0 = sr.left - hostRect.left;
  const viewTop = buf.viewportY;
  const viewBottom = viewTop + term.rows - 1;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* clipboard denied */
    }
    term.focus();
  };

  const rerun = (b: Block) => {
    if (tracker.running) return;
    // ^U clears anything already typed at the prompt.
    writeToPane(paneId, "\x15" + b.command + "\r");
    term.scrollToBottom();
    term.focus();
  };

  const items = [];
  for (const b of tracker.blocks) {
    const r = tracker.range(b);
    if (!r || r.end < viewTop || r.start > viewBottom) continue;
    const startRow = Math.max(r.start, viewTop) - viewTop;
    const endRow = Math.min(r.end, viewBottom) - viewTop;
    const top = top0 + startRow * rowH;
    const height = (endRow - startRow + 1) * rowH;
    const running = !b.end;
    const failed = !running && b.exitCode !== undefined && b.exitCode !== 0;
    const state = running ? "running" : failed ? "failed" : "ok";
    const headerVisible = r.start >= viewTop;
    const showToolbar = hoverId === b.id && headerVisible;
    const duration = (b.endedAt ?? performance.now()) - b.startedAt;

    items.push(
      <div key={b.id}>
        {headerVisible && <div className="block-sep" style={{ top: top - 1, left: left0 - 6 }} />}
        {failed && <div className="block-tint" style={{ top, height, left: left0 - 6 }} />}
        <div
          className={`block-gutter ${state}${hoverId === b.id ? " hover" : ""}`}
          style={{ top: top + 1, height: Math.max(2, height - 2), left: Math.max(2, left0 - 8) }}
          title="Click to select block"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            term.selectLines(r.start, r.end);
          }}
        />
        {showToolbar && (
          <div
            className="block-toolbar"
            style={{ top: top + 2 }}
            onMouseLeave={() => setHoverId(null)}
            onMouseDown={(e) => e.preventDefault()}
          >
            <span className={`block-status ${state}`}>
              {running ? "running" : b.exitCode === undefined ? "done" : failed ? `exit ${b.exitCode}` : "✓"}
            </span>
            <span className="block-duration">{formatDuration(duration)}</span>
            <button title="Copy command" onClick={() => copy(b.command, "cmd")} disabled={!b.command}>
              <TerminalIcon />
              {copied === "cmd" ? "Copied" : "Command"}
            </button>
            <button title="Copy output" onClick={() => copy(tracker.outputText(b), "out")}>
              <CopyIcon />
              {copied === "out" ? "Copied" : "Output"}
            </button>
            <button title="Run again" onClick={() => rerun(b)} disabled={!b.command || !!tracker.running}>
              <RerunIcon />
              Rerun
            </button>
          </div>
        )}
      </div>,
    );
  }

  return <div className="block-overlay">{items}</div>;
}
