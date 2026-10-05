import { useEffect, useRef, useState } from "react";
import { formatDuration } from "../lib/format";
import { showPane, submitToPane } from "../lib/terminals";
import { useLayout } from "../store/layout";
import { useNotices, type Notice } from "../store/notifications";
import { toast } from "../store/ui";
import { BellIcon, CloseIcon } from "./Icons";

const MAX_CARDS = 4;

function ago(at: number) {
  const ms = Date.now() - at;
  return ms < 10_000 ? "now" : formatDuration(ms);
}

function Card({ n }: { n: Notice }) {
  const { dismiss } = useNotices.getState();
  const [draft, setDraft] = useState("");
  const paneAlive = useLayout((s) => !!n.paneId && !!s.panes[n.paneId]);

  const open = () => {
    if (!n.paneId || !paneAlive) return;
    showPane(n.paneId);
    dismiss(n.id);
  };
  const reply = () => {
    const text = draft.trim();
    if (!text || !n.paneId) return;
    if (!submitToPane(n.paneId, text)) return toast("That pane is gone", true);
    dismiss(n.id);
  };

  return (
    <div className={`notice ${n.kind}`} role="status">
      <div className="notice-head">
        <span className={`notice-dot ${n.kind}`} />
        <button className="notice-title" onClick={open} disabled={!paneAlive} title={paneAlive ? "Open pane" : undefined}>
          {n.title}
        </button>
        <span className="notice-ago">{ago(n.at)}</span>
        <button className="icon-btn notice-close" onClick={() => dismiss(n.id)} title="Dismiss">
          <CloseIcon width={10} height={10} />
        </button>
      </div>
      {n.body && <div className="notice-body">{n.body}</div>}
      {(n.actions?.length || paneAlive) && (
        <div className="notice-actions">
          {n.actions?.map((a) => (
            <button
              key={a.label}
              className={`notice-btn${a.tone ? ` ${a.tone}` : ""}`}
              onClick={() => {
                if (a.run() !== false) dismiss(n.id);
              }}
            >
              {a.label}
            </button>
          ))}
          {paneAlive && (
            <button className="notice-btn" onClick={open}>
              Open
            </button>
          )}
        </div>
      )}
      {n.reply && paneAlive && (
        <form
          className="notice-reply"
          onSubmit={(e) => {
            e.preventDefault();
            reply();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && dismiss(n.id)}
            placeholder="Reply to Claude…"
            spellCheck={false}
          />
        </form>
      )}
    </div>
  );
}

/** Live cards, newest on top, bottom-right of the window. */
export function NoticeStack() {
  const notices = useNotices((s) => s.notices);
  const live = notices.filter((n) => n.live);
  // Re-render for the "ago" labels.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live.length) return;
    const id = setInterval(() => tick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [live.length]);

  if (!live.length) return null;
  const shown = live.slice(0, MAX_CARDS);
  const hidden = live.length - shown.length;
  return (
    <div className="notice-stack">
      {shown.map((n) => (
        <Card key={n.id} n={n} />
      ))}
      {hidden > 0 && (
        <button className="notice-more" onClick={() => live.slice(MAX_CARDS).forEach((n) => useNotices.getState().dismiss(n.id))}>
          +{hidden} more · dismiss
        </button>
      )}
    </div>
  );
}

/** Title-bar bell: unread count, and the history of everything that was shown. */
export function NoticeBell() {
  const notices = useNotices((s) => s.notices);
  const unread = notices.filter((n) => !n.read).length;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    useNotices.getState().markAllRead();
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open, notices.length]);

  return (
    <div className="notice-bell" ref={ref}>
      <button className={`icon-btn${open ? " on" : ""}`} title="Notifications" onClick={() => setOpen(!open)}>
        <BellIcon />
        {unread > 0 && <span className="notice-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="notice-history">
          <div className="notice-history-head">
            <span>Notifications</span>
            {notices.length > 0 && (
              <button className="link-btn" onClick={() => useNotices.getState().clear()}>
                clear
              </button>
            )}
          </div>
          {notices.length === 0 ? (
            <p className="empty">Nothing yet. Finished sessions, prompts and limit warnings land here.</p>
          ) : (
            notices.map((n) => (
              <button
                key={n.id}
                className={`notice-row${n.live ? " live" : ""}`}
                onClick={() => {
                  if (n.paneId && useLayout.getState().panes[n.paneId]) {
                    showPane(n.paneId);
                    useNotices.getState().dismiss(n.id);
                    setOpen(false);
                  }
                }}
              >
                <span className={`notice-dot ${n.kind}`} />
                <span className="notice-row-main">
                  <span className="notice-row-title">{n.title}</span>
                  {n.body && <span className="notice-row-body">{n.body}</span>}
                </span>
                <span className="notice-ago">{ago(n.at)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
