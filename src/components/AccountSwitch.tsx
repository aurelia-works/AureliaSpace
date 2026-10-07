import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { switchAccount } from "../lib/handoff";
import { headroom } from "../lib/limits";
import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { useLayout } from "../store/layout";
import { useUsage } from "../store/usage";

/** The pane's account chip; click to move this Claude session to another account, keeping the thread. */
export function AccountSwitch({ paneId, account }: { paneId: string; account: string }) {
  const accounts = useConfig((s) => s.config?.accounts ?? []);
  const usage = useUsage((s) => s.usage);
  const agent = useAgents((s) => s.sessions[paneId]);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    accounts.forEach((a) => useUsage.getState().refresh(a.name));
    const close = () => setPos(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [pos, accounts]);

  const open = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left, y: r.bottom + 4 });
  };
  const pick = (name: string) => {
    setPos(null);
    if (name !== useLayout.getState().panes[paneId]?.account) void switchAccount(paneId, name);
  };

  return (
    <>
      <button ref={btn} className="account-chip switchable" title="Move this session to another account (keeps the conversation)" onClick={open}>
        {account} ▾
      </button>
      {pos &&
        createPortal(
          <div className="account-menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="account-menu-head">
              Continue on…{agent?.status === "working" && <span> · interrupts the current turn</span>}
            </div>
            {accounts.map((a) => {
              const room = headroom(usage[a.name]);
              return (
                <button key={a.name} className={a.name === account ? "on" : ""} onClick={() => pick(a.name)}>
                  <span>{a.name}</span>
                  <span className="account-room">{a.name === account ? "current" : room === null ? "" : room <= 0 ? "limited" : `${Math.round(room)}% left`}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
