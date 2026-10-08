import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatCost } from "../lib/format";
import { applyPaletteVars } from "../lib/palettes";
import type { HudAction, HudRow, HudSnapshot, HudUsage } from "./types";

const act = (a: HudAction) => emitTo("main", "hud-action", a).catch(() => {});

function Pct({ label, pct, eta }: { label: string; pct: number | null; eta: string | null }) {
  const v = pct ?? 0;
  return (
    <span className={`hud-pct${eta ? " out" : ""}`} title={eta ?? undefined}>
      {label} <b className={v >= 90 ? "crit" : v >= 70 ? "warn" : ""}>{pct === null ? "–" : `${Math.round(v)}%`}</b>
      {eta && <i>{eta}</i>}
    </span>
  );
}

function UsageLine({ u }: { u: HudUsage }) {
  return (
    <div className="hud-usage">
      <span className="hud-acct">{u.account}</span>
      <Pct label="5h" pct={u.fiveHour} eta={u.fiveEta} />
      <Pct label="7d" pct={u.sevenDay} eta={u.sevenEta} />
    </div>
  );
}

function Row({ r }: { r: HudRow }) {
  const dot = r.status === "needs_input" ? "needs_input" : r.attention ? "done" : r.status;
  const meta = [r.contextPct !== undefined && `${Math.round(r.contextPct)}%`, r.costUsd !== undefined && formatCost(r.costUsd)].filter(Boolean);
  return (
    <div className={`hud-row ${dot}`} onClick={() => act({ type: "open", paneId: r.paneId })}>
      <span className={`glyph ${dot}`} aria-hidden />
      <div className="hud-main">
        <div className="hud-title">
          <span className="hud-acct">{r.account}</span>
          <span className="hud-folder">{r.folder}</span>
          {meta.length > 0 && <span className={`hud-meta${r.hot ? " hot" : ""}`}>{meta.join(" · ")}</span>}
        </div>
        <div className="hud-text">{r.text}</div>
        {r.perm && (
          <div className="hud-perm" onClick={(e) => e.stopPropagation()}>
            <button className="primary" onClick={() => act({ type: "permission", paneId: r.paneId, choice: "allow" })}>Allow</button>
            {r.perm.always && <button onClick={() => act({ type: "permission", paneId: r.paneId, choice: "always" })}>Always</button>}
            <button className="danger" onClick={() => act({ type: "permission", paneId: r.paneId, choice: "deny" })}>Deny</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Hud() {
  const [snap, setSnap] = useState<HudSnapshot | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const un = listen<HudSnapshot>("hud-state", (e) => setSnap(e.payload));
    // Listener is registered before asking, so the first snapshot can't be missed.
    un.then(() => emitTo("main", "hud-ready", null)).catch(() => {});
    return () => void un.then((f) => f());
  }, []);

  useEffect(() => {
    if (!snap) return;
    document.documentElement.dataset.theme = snap.dark ? "dark" : "light";
    applyPaletteVars(snap.palette, snap.dark);
  }, [snap?.dark, snap?.palette]);

  // The window is sized to the content, so measure the panel and tell Rust.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    let prev = 0;
    const fit = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h !== prev) {
        prev = h;
        void invoke("hud_resize", { height: h });
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [snap !== null]);

  if (!snap) return null;
  return (
    <div className="hud-panel" ref={panel}>
      <div className="hud-head" data-tauri-drag-region>
        <span className="hud-brand" data-tauri-drag-region>
          Aurelia <b data-tauri-drag-region>{snap.rows.filter((r) => r.status === "needs_input").length || ""}</b>
        </span>
        <div className="hud-usages" data-tauri-drag-region>
          {snap.usage.map((u) => (
            <UsageLine key={u.account} u={u} />
          ))}
        </div>
      </div>
      <div className="hud-rows">
        {snap.rows.map((r) => (
          <Row key={r.paneId} r={r} />
        ))}
      </div>
    </div>
  );
}
