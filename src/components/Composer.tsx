import { useEffect, useRef, useState } from "react";
import { cacheSafe, currentEffort, EFFORT_LEVELS, sendPrompt } from "../lib/effort";
import { ipc, type EffortLevel, type EffortPick } from "../lib/ipc";
import { enqueue, unqueue, useOutbox } from "../lib/outbox";
import { focusTerminal } from "../lib/terminals";
import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { useLayout } from "../store/layout";
import { useLive } from "../store/live";
import { usePrompts } from "../store/prompts";
import { toast, useUi } from "../store/ui";
import { SparkIcon } from "./Icons";

const MAX_ROWS = 8;

/**
 * ⌘L: write a prompt for the pane, multi-line, and send it with Enter. On a Claude pane the
 * effort is picked for it first (lib/effort.ts): the chip shows the rules' preview, and a
 * click overrides it for this message. While Claude works, Enter queues the message for the
 * end of the turn (lib/outbox.ts) and ⌘Enter steers: it goes in now, as is.
 */
export function Composer({ paneId }: { paneId: string }) {
  const [text, setText] = useState("");
  const [override, setOverride] = useState<EffortLevel | null>(null);
  const [preview, setPreview] = useState<EffortPick | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const account = useLayout((s) => s.panes[paneId]?.account);
  const model = useLive((s) => s.byPane[paneId]?.model);
  const modelName = useLive((s) => s.byPane[paneId]?.modelName);
  const effort = useLive((s) => s.byPane[paneId]?.effort);
  const status = useAgents((s) => s.sessions[paneId]?.status);
  const auto = useConfig((s) => s.config?.effort?.auto !== false);
  const queued = useOutbox((s) => s.byPane[paneId]);
  const draft = useUi((s) => (s.composerDraft?.paneId === paneId ? s.composerDraft.text : null));
  const canSwitch = !!account && cacheSafe(model);
  const busyAgent = status === "working" || status === "starting";

  useEffect(() => {
    ref.current?.focus();
  }, []);

  // A saved prompt or prompt link opened this composer: start from its text, once.
  useEffect(() => {
    if (draft === null) return;
    setText(draft);
    setOverride(null);
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

  // Rules-only preview while typing: free, instant, never calls the judge.
  useEffect(() => {
    if (!canSwitch || !auto || !text.trim()) return setPreview(null);
    const t = setTimeout(() => {
      ipc.chooseEffort(account ?? null, text, false).then(setPreview).catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [text, account, canSwitch, auto]);

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
      setOverride(null);
      setPreview(null);
      setNote("Queued: goes out when Claude finishes this turn · ⌘Enter steers instead");
      return;
    }
    setBusy(true);
    const r = await sendPrompt(paneId, t, override ?? undefined).finally(() => setBusy(false));
    if (!r.sent) return toast("That pane isn't running", true);
    setText("");
    setOverride(null);
    setPreview(null);
    if (r.switchedTo) setNote(`Effort → ${r.switchedTo} (this session) · ${r.pick?.why}`);
    else if (r.pick) setNote(`Effort stays ${currentEffort(paneId) ?? "as it is"} · ${r.pick.why}`);
    else setNote(null);
  };

  const cycle = () => {
    const order: (EffortLevel | null)[] = [null, ...EFFORT_LEVELS];
    setOverride(order[(order.indexOf(override) + 1) % order.length]);
  };

  const chip = override
    ? `${override} · yours`
    : !auto
      ? `${effort ?? "effort"} · auto off`
      : preview?.level
        ? `Auto · ${preview.level}${preview.pending ? "?" : ""}`
        : preview?.source === "keep"
          ? `Auto · keep ${effort ?? ""}`.trim()
          : `Auto${effort ? ` · now ${effort}` : ""}`;
  const chipTitle = override
    ? "Sends at this effort. Click to cycle; back to Auto after low…max."
    : preview?.pending
      ? `${preview.why}. Haiku 5.5 makes the call when you send.`
      : (preview?.why ?? "Effort is picked when you send. Click to choose one yourself.");

  const foot = !account
    ? "Sends to the shell · Enter to send, ⇧Enter for a new line · Esc to close"
    : !canSwitch
      ? `Effort stays fixed${modelName ? ` on ${modelName}` : ""}: switching it there would rewrite the prompt cache · Enter to send · Esc to close`
      : busyAgent
        ? "Claude is working · Enter queues it for the end of the turn · ⌘Enter steers it in now · Esc to close"
        : status && status !== "idle"
        ? "Claude is waiting on you: this is sent as is, effort unchanged · Enter to send · Esc to close"
        : "Enter to send, ⇧Enter for a new line · effort set for this session only · Esc to close";

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
        {canSwitch && (
          <button type="button" className={`effort-chip${override ? " manual" : ""}`} onClick={cycle} title={chipTitle}>
            {chip}
          </button>
        )}
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
      {busy && <div className="suggest-status">{override || !canSwitch || !auto ? "Sending…" : "Picking the effort…"}</div>}
      {!busy && note && <div className="suggest-status">{note}</div>}
      <div className="suggest-foot">{foot}</div>
    </div>
  );
}
