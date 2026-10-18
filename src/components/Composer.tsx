import { useEffect, useRef, useState } from "react";
import { sendPrompt } from "../lib/effort";
import { ipc } from "../lib/ipc";
import { enqueue, unqueue, useOutbox } from "../lib/outbox";
import { focusTerminal } from "../lib/terminals";
import { useAgents } from "../store/agents";
import { useLayout } from "../store/layout";
import { usePrompts } from "../store/prompts";
import { toast, useUi } from "../store/ui";
import { SparkIcon } from "./Icons";

const MAX_ROWS = 8;

/**
 * ⌘L: write a multi-line prompt for the pane and send it with Enter. Auto effort applies as
 * it does to text typed straight into Claude (lib/effort.ts). While Claude works, Enter
 * queues the message for the end of the turn (lib/outbox.ts) and ⌘Enter steers it in now.
 */
export function Composer({ paneId }: { paneId: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const account = useLayout((s) => s.panes[paneId]?.account);
  const status = useAgents((s) => s.sessions[paneId]?.status);
  const queued = useOutbox((s) => s.byPane[paneId]);
  const draft = useUi((s) => (s.composerDraft?.paneId === paneId ? s.composerDraft.text : null));
  const busyAgent = status === "working" || status === "starting";

  useEffect(() => {
    ref.current?.focus();
  }, []);

  // A saved prompt or prompt link opened this composer: start from its text, once.
  useEffect(() => {
    if (draft === null) return;
    setText(draft);
    useUi.getState().set({ composerDraft: null });
    requestAnimationFrame(() => {
      const el = ref.current;
      el?.focus();
      el?.setSelectionRange(draft.length, draft.length);
    });
  }, [draft]);

  // Grow with the text up to MAX_ROWS, then scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 18;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_ROWS + 8)}px`;
  }, [text]);

  const close = () => {
    useUi.getState().set({ composerPaneId: null });
    focusTerminal(paneId);
  };

  const send = async (steer: boolean) => {
    const t = text.trim();
    if (!t || busy) return;
    if (busyAgent && !steer) {
      enqueue(paneId, t);
      setText("");
      setNote("Queued: goes out when Claude finishes this turn · ⌘Enter steers instead");
      return;
    }
    setBusy(true);
    const r = await sendPrompt(paneId, t).finally(() => setBusy(false));
    if (!r.sent) return toast("That pane isn't running", true);
    setText("");
    setNote(r.switchedTo ? `Effort → ${r.switchedTo} for this session · ${r.pick?.why}` : null);
  };

  const foot = !account
    ? "Sends to the shell · Enter to send, ⇧Enter for a new line · Esc to close"
    : busyAgent
      ? "Claude is working · Enter queues it for the end of the turn · ⌘Enter steers it in now"
      : "Enter to send · ⇧Enter for a new line · Esc to close";

  return (
    <div
      className="suggest-bar composer"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          send(e.metaKey);
        }
      }}
    >
      <div className="suggest-row composer-row">
        <SparkIcon className="suggest-icon" />
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={account ? "Message Claude…" : "Type a command or message…"}
          onChange={(e) => {
            setText(e.target.value);
            if (note) setNote(null);
          }}
          disabled={busy}
          spellCheck={false}
        />
        <button
          type="button"
          className="composer-save"
          title="SnapShot: drag out part of the screen (Space for a window); its path goes into the message for Claude to look at"
          onClick={async () => {
            const path = await ipc.snapCapture().catch((e) => (toast(`Couldn't capture: ${e}`, true), null));
            if (path) setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}${path} `);
            ref.current?.focus();
          }}
        >
          Snap
        </button>
        {text.trim() && (
          <button type="button" className="composer-save" onClick={() => usePrompts.getState().save(text)} title="Save to Prompts (right rail, ⌘B) to reuse later">
            Save
          </button>
        )}
      </div>
      {queued && queued.length > 0 && (
        <ol className="composer-queue" aria-label="Queued messages">
          {queued.map((q, i) => (
            <li key={`${i}:${q}`}>
              <span className="composer-queue-n num">{i === 0 ? "next" : i + 1}</span>
              <span className="composer-queue-text" title={q}>
                {q}
              </span>
              <button type="button" className="icon-btn sm" onClick={() => unqueue(paneId, i)} title="Remove from the queue" aria-label="Remove from the queue">
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
      {busy && <div className="suggest-status">Sending…</div>}
      {!busy && note && <div className="suggest-status">{note}</div>}
      <div className="suggest-foot">{foot}</div>
    </div>
  );
}
