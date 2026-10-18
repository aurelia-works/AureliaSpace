import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";

/** One pane as the desktop describes it (lib/remote.ts builds the snapshot). */
export interface RemotePane {
  id: string;
  title: string;
  where?: string;
  account?: string;
  tab: number;
  /** A StatusGlyph state: needs_input, done, working, starting, idle, or shell. */
  status: string;
  message?: string;
  /** A permission dialog is on screen in the pane; `always` when it offers "don't ask again". */
  permission?: {
    always: boolean;
    tool?: string;
    /** The command, file or URL it wants to use. */
    what?: string;
    /** Why it looks risky (lib/risk.ts), if it does. */
    risk?: string;
    /** Sent back with the answer; the desktop ignores answers to a request that has changed. */
    key: string;
  };
}

export interface Snapshot {
  panes: RemotePane[];
  accounts?: string[];
  projects?: { name: string; path: string }[];
  /** The pane the desktop opened for the phone's last "new" action. */
  created?: { nonce: string; pane: string };
}

type Conn = "connecting" | "open" | "closed" | "unpaired";
type Msg = { t: string; [k: string]: unknown };

/** The phone's one WebSocket to the app: reconnects on its own, replays nothing itself. */
class Link {
  ws: WebSocket | null = null;
  conn: Conn = "connecting";
  snap: Snapshot = { panes: [] };
  private subs = new Set<() => void>();
  private msgs = new Set<(m: Msg) => void>();
  private data = new Set<(b: Uint8Array) => void>();
  private retry = 0;
  private timer = 0;

  connect() {
    clearTimeout(this.timer);
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.set("connecting");
    ws.onopen = () => {
      this.retry = 0;
      this.set("open");
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return this.data.forEach((f) => f(new Uint8Array(e.data)));
      const m = JSON.parse(e.data) as Msg;
      if (m.t === "snap") {
        this.snap = m.snap as Snapshot;
        this.emit();
      }
      this.msgs.forEach((f) => f(m));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.set("closed");
      // A refused upgrade looks like any other drop; ask the page whether we're still paired.
      if (this.retry >= 2)
        fetch("/", { cache: "no-store" })
          .then((r) => r.status === 401 && this.set("unpaired"))
          .catch(() => {});
      const wait = Math.min(5000, 400 * 2 ** this.retry++);
      this.timer = window.setTimeout(() => document.visibilityState === "visible" && this.connect(), wait);
    };
  }

  send(m: Msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  type(d: string) {
    this.send({ t: "in", d });
  }

  private set(c: Conn) {
    if (this.conn === "unpaired" && c !== "open") return;
    this.conn = c;
    this.emit();
  }
  private emit() {
    this.subs.forEach((f) => f());
  }
  subscribe = (f: () => void) => {
    this.subs.add(f);
    return () => void this.subs.delete(f);
  };
  onMessage(f: (m: Msg) => void) {
    this.msgs.add(f);
    return () => void this.msgs.delete(f);
  }
  onData(f: (b: Uint8Array) => void) {
    this.data.add(f);
    return () => void this.data.delete(f);
  }
}

const link = new Link();

function useLink() {
  const conn = useSyncExternalStore(link.subscribe, () => link.conn);
  const snap = useSyncExternalStore(link.subscribe, () => link.snap);
  return { conn, snap };
}

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

const LABEL: Record<string, string> = {
  needs_input: "needs you",
  done: "finished",
  working: "working",
  starting: "starting",
  idle: "idle",
  shell: "shell",
};
const URGENCY: Record<string, number> = { needs_input: 0, done: 1, working: 2, starting: 3, idle: 4, shell: 5 };

export function Remote() {
  const { conn, snap } = useLink();
  const [paneId, setPaneId] = useState<string | null>(() => (location.hash.startsWith("#p=") ? decodeURIComponent(location.hash.slice(3)) : null));

  useEffect(() => {
    link.connect();
    // Leaving Safari or locking the phone lets go of the pane right away (the desktop
    // gets its size back) instead of when the dead connection finally times out.
    const wake = () => (document.visibilityState === "visible" ? link.connect() : link.ws?.close());
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, []);

  // The keyboard shrinks the visual viewport, not the layout one, on iOS: size the app to what's visible.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => {
      document.documentElement.style.setProperty("--app-h", `${vv.height}px`);
      window.scrollTo(0, 0);
    };
    fit();
    vv.addEventListener("resize", fit);
    return () => vv.removeEventListener("resize", fit);
  }, []);

  const open = useCallback((id: string | null) => {
    setPaneId(id);
    history.replaceState(null, "", id ? `#p=${encodeURIComponent(id)}` : location.pathname);
  }, []);

  const pane = snap.panes.find((p) => p.id === paneId);

  if (conn === "unpaired") {
    return (
      <div className="rm-app rm-center">
        <h1>Pair this phone</h1>
        <p>On your Mac, open AureliaSpace → Settings → Remote and scan the QR code with this phone's camera.</p>
      </div>
    );
  }

  return (
    <div className="rm-app">
      {paneId && pane ? <PaneView pane={pane} conn={conn} onBack={() => open(null)} /> : <PaneList snap={snap} conn={conn} onOpen={open} />}
    </div>
  );
}

function ConnDot({ conn }: { conn: Conn }) {
  const text = conn === "open" ? "Connected" : conn === "connecting" ? "Connecting…" : "Offline, retrying";
  return <span className={`rm-conn ${conn}`} role="status" aria-label={text} title={text} />;
}

function Mark() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id="rm-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd98a" />
          <stop offset="0.55" stopColor="#e9b04b" />
          <stop offset="1" stopColor="#b9792a" />
        </linearGradient>
      </defs>
      <path d="M3 12.2C3 6.9 7 4 12 4s9 2.9 9 8.2c-1.6-.5-2.9.4-4.2-.1-1-.4-1.6.4-2.4.4h-4.8c-.8 0-1.4-.8-2.4-.4-1.3.5-2.6-.4-4.2.1z" fill="url(#rm-gold)" />
      <g fill="none" stroke="url(#rm-gold)" strokeWidth="1.6" strokeLinecap="round">
        <path d="M7 14c-.5 1.8.8 3-.1 5" />
        <path d="M10.3 14.3c-.5 2 .8 3.2 0 5.7" />
        <path d="M13.7 14.3c.5 2-.8 3.2 0 5.7" />
        <path d="M17 14c.5 1.8-.8 3 .1 5" />
      </g>
    </svg>
  );
}

function PaneList({ snap, conn, onOpen }: { snap: Snapshot; conn: Conn; onOpen(id: string): void }) {
  const [creating, setCreating] = useState(false);
  const panes = useMemo(
    () => [...snap.panes].sort((a, b) => (URGENCY[a.status] ?? 9) - (URGENCY[b.status] ?? 9) || a.tab - b.tab),
    [snap.panes],
  );
  const needs = panes.filter((p) => p.status === "needs_input" || p.status === "done");
  const rest = panes.filter((p) => !needs.includes(p));

  // Open the pane the desktop made for this phone's "new" request.
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (snap.created && snap.created.nonce === pending.current && snap.panes.some((p) => p.id === snap.created!.pane)) {
      pending.current = null;
      onOpen(snap.created.pane);
    }
  }, [snap, onOpen]);

  const row = (p: RemotePane) => (
    <li key={p.id} className={p.permission ? "rm-asking" : undefined}>
      <button className="rm-row" onClick={() => onOpen(p.id)}>
        <span className={`glyph ${p.status}`} role="img" aria-label={LABEL[p.status] ?? p.status} />
        <span className="rm-row-main">
          <span className="rm-row-title">
            {p.title}
            {p.where && <span className="rm-row-where"> · {p.where}</span>}
          </span>
          <span className="rm-row-sub">{p.message || [LABEL[p.status], p.account].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="rm-tab num">{p.tab}</span>
      </button>
      {p.permission && <Approve pane={p} />}
    </li>
  );

  return (
    <>
      <header className="rm-bar">
        <span className="rm-brand">
          <Mark />
          AureliaSpace
        </span>
        <ConnDot conn={conn} />
      </header>
      <main className="rm-list">
        {conn !== "open" && !snap.panes.length && <p className="rm-empty">Reaching your Mac…</p>}
        {conn === "open" && !snap.panes.length && <p className="rm-empty">No terminals open on your Mac.</p>}
        {needs.length > 0 && (
          <section>
            <h2>Needs you</h2>
            <ul>{needs.map(row)}</ul>
          </section>
        )}
        {rest.length > 0 && (
          <section>
            <h2>{needs.length ? "Everything else" : "Panes"}</h2>
            <ul>{rest.map(row)}</ul>
          </section>
        )}
      </main>
      <button className="rm-fab" onClick={() => setCreating(true)} aria-label="New pane" disabled={conn !== "open"}>
        <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden>
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {creating && (
        <NewSheet
          snap={snap}
          onClose={() => setCreating(false)}
          onCreate={(account, cwd) => {
            const nonce = Math.random().toString(36).slice(2);
            pending.current = nonce;
            link.send({ t: "action", action: { kind: "new", account, cwd, nonce } });
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

/** Allow / Always / Deny for the permission dialog showing in a pane on the Mac. */
function Approve({ pane }: { pane: RemotePane }) {
  const [sent, setSent] = useState(false);
  // A new dialog (or the same pane asking again) gets fresh buttons.
  const key = pane.permission?.key;
  useEffect(() => setSent(false), [key]);
  if (!pane.permission || !key) return null;
  const { tool, what, risk } = pane.permission;
  const answer = (choice: "allow" | "always" | "deny") => {
    setSent(true);
    link.send({ t: "action", action: { kind: "permission", pane: pane.id, choice, key } });
  };
  return (
    <div className="rm-approve" role="group" aria-label="Answer the permission request">
      {(tool || what) && (
        <div className="rm-approve-what">
          {risk && <span className="rm-risk">{risk}</span>}
          {tool && <strong>{tool}</strong>}
          {what && <code>{what}</code>}
        </div>
      )}
      <button className="rm-btn primary" disabled={sent} onClick={() => answer("allow")}>
        Allow
      </button>
      {pane.permission.always && (
        <button className="rm-btn" disabled={sent} onClick={() => answer("always")}>
          Always
        </button>
      )}
      <button className="rm-btn danger" disabled={sent} onClick={() => answer("deny")}>
        Deny
      </button>
    </div>
  );
}

function NewSheet({ snap, onClose, onCreate }: { snap: Snapshot; onClose(): void; onCreate(account: string | null, cwd: string | null): void }) {
  const projects = snap.projects ?? [];
  const [cwd, setCwd] = useState<string | null>(() => store.get("rm.project") ?? projects[0]?.path ?? null);
  const pick = (p: string | null) => {
    setCwd(p);
    if (p) store.set("rm.project", p);
  };
  return (
    <div className="rm-sheet-bg" onClick={onClose}>
      <div className="rm-sheet" role="dialog" aria-label="New pane" onClick={(e) => e.stopPropagation()}>
        <h2>New pane</h2>
        {projects.length > 0 && (
          <>
            <h3>In</h3>
            <div className="rm-chips">
              {projects.map((p) => (
                <button key={p.path} className={`rm-chip${cwd === p.path ? " on" : ""}`} onClick={() => pick(p.path)}>
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}
        <h3>Run</h3>
        <div className="rm-sheet-actions">
          {(snap.accounts ?? []).map((a) => (
            <button key={a} className="rm-btn primary" onClick={() => onCreate(a, cwd)}>
              Claude · {a}
            </button>
          ))}
          <button className="rm-btn" onClick={() => onCreate(null, cwd)}>
            Terminal
          </button>
        </div>
        <button className="rm-btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const KEYS: { label: string; seq: string; aria: string }[] = [
  { label: "esc", seq: "\x1b", aria: "Escape" },
  { label: "⇥", seq: "\t", aria: "Tab" },
  { label: "⇧⇥", seq: "\x1b[Z", aria: "Shift Tab" },
  { label: "↑", seq: "\x1b[A", aria: "Up" },
  { label: "↓", seq: "\x1b[B", aria: "Down" },
  { label: "←", seq: "\x1b[D", aria: "Left" },
  { label: "→", seq: "\x1b[C", aria: "Right" },
  { label: "1", seq: "1", aria: "1" },
  { label: "2", seq: "2", aria: "2" },
  { label: "3", seq: "3", aria: "3" },
  { label: "^C", seq: "\x03", aria: "Control C" },
  { label: "⏎", seq: "\r", aria: "Return" },
];

const THEME = {
  background: "#0b0d11",
  foreground: "#ece8e1",
  cursor: "#f2b544",
  cursorAccent: "#0b0d11",
  selectionBackground: "#f2b54455",
  black: "#1c1f27",
  red: "#ff7b72",
  green: "#79d29a",
  yellow: "#f2b544",
  blue: "#6ea8fe",
  magenta: "#d2a8ff",
  cyan: "#62c6de",
  white: "#ece8e1",
  brightBlack: "#7d818c",
  brightRed: "#ffa198",
  brightGreen: "#a6e3b8",
  brightYellow: "#ffcb6b",
  brightBlue: "#9ec5fe",
  brightMagenta: "#e2c5ff",
  brightCyan: "#9ee3f0",
  brightWhite: "#ffffff",
};

function PaneView({ pane, conn, onBack }: { pane: RemotePane; conn: Conn; onBack(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [fitMode, setFitMode] = useState(() => store.get("rm.mode") !== "mirror");
  const [font, setFont] = useState(() => Number(store.get("rm.font")) || 12);
  const [ended, setEnded] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const fitModeRef = useRef(fitMode);
  fitModeRef.current = fitMode;
  /** The PTY's real size (the server says), and the size this phone asked for. */
  const pty = useRef<{ cols: number; rows: number } | null>(null);
  const asked = useRef<{ cols: number; rows: number } | null>(null);
  /** Another screen set the size since: we show its size rather than garble it. */
  const [foreign, setForeign] = useState(false);

  const size = () => {
    const fit = fitRef.current?.proposeDimensions();
    return fit && fit.cols > 0 && fit.rows > 0 ? { cols: fit.cols, rows: fit.rows } : null;
  };

  /**
   * The terminal always has the PTY's exact size: the program draws for that width, and
   * output drawn at any other width garbles. Fit asks for the phone's size (and takes it
   * back from another device); Desktop size asks for nothing.
   */
  const follow = useCallback((sz: { cols: number; rows: number }) => {
    pty.current = sz;
    const term = termRef.current;
    if (term && (term.cols !== sz.cols || term.rows !== sz.rows)) term.resize(sz.cols, sz.rows);
    const a = asked.current;
    setForeign(fitModeRef.current && !!a && (a.cols !== sz.cols || a.rows !== sz.rows));
  }, []);

  const layout = useCallback(() => {
    if (!termRef.current) return;
    if (fitModeRef.current) {
      const s = size();
      if (!s) return;
      asked.current = s;
      link.send({ t: "fit", fit: s });
    } else {
      asked.current = null;
      setForeign(false);
      link.send({ t: "fit", fit: null });
    }
  }, []);

  // The terminal, for this pane.
  useEffect(() => {
    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: font,
      lineHeight: 1.1,
      scrollback: 5000,
      theme: THEME,
      allowProposedApi: true,
      cursorBlink: false,
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(host.current!);
    // The phone types through the composer, never into xterm: iOS dictation into xterm's
    // hidden textarea sent the text twice, and each backspace there was a round trip to
    // the Mac. Taps still reach the program as mouse clicks.
    const composer = () => document.querySelector<HTMLTextAreaElement>(".rm-compose textarea");
    if (term.textarea) {
      term.textarea.readOnly = true;
      term.textarea.inputMode = "none";
      // xterm focuses it on every tap; hand the keyboard to the composer instead.
      term.textarea.addEventListener("focus", () => composer()?.focus());
    }
    termRef.current = term;
    fitRef.current = fit;
    setEnded(false);

    const offData = link.onData((b) => term.write(b));
    const offMsg = link.onMessage((m) => {
      if (m.t === "opened" && m.pane === pane.id) {
        const sz = m.size as { cols: number; rows: number } | null;
        if (sz) follow(sz);
      } else if (m.t === "size") follow({ cols: m.cols as number, rows: m.rows as number });
      else if (m.t === "exit") setEnded(true);
    });
    const onInput = term.onData((d) => link.type(d));

    let timer = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(layout, 120);
    });
    ro.observe(host.current!);

    // Swipes scroll (xterm's own touch scrolling is unreliable on phones). A program
    // that reads the mouse, like Claude Code on its full-screen view, has no scrollback
    // for xterm to scroll: it gets mouse-wheel reports and scrolls itself.
    const el = host.current!;
    let last: { x: number; y: number } | null = null;
    let axis: "x" | "y" | null = null;
    let carry = 0;
    const start = (e: TouchEvent) => {
      last = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      axis = null;
      carry = 0;
    };
    const move = (e: TouchEvent) => {
      if (!last) return;
      const { clientX: x, clientY: y } = e.touches[0];
      // Sideways swipes pan a terminal wider than the phone; leave those to the browser.
      axis ??= Math.abs(x - last.x) > Math.abs(y - last.y) ? "x" : "y";
      if (axis === "x") return;
      e.preventDefault();
      const cell = term.options.fontSize! * 1.1 * 1.2;
      carry += last.y - y;
      last = { x, y };
      const lines = Math.trunc(carry / cell);
      if (!lines) return;
      carry -= lines * cell;
      if (term.modes.mouseTrackingMode !== "none") {
        const at = `${Math.ceil(term.cols / 2)};${Math.ceil(term.rows / 2)}`;
        link.type(`\x1b[<${lines > 0 ? 65 : 64};${at}M`.repeat(Math.abs(lines)));
      } else term.scrollLines(lines);
    };
    const end = () => (last = null);
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);

    return () => {
      offData();
      offMsg();
      onInput.dispose();
      ro.disconnect();
      clearTimeout(timer);
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      link.send({ t: "close" });
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id]);

  // (Re)attach whenever the socket (re)opens: the server replays the pane's recent output.
  useEffect(() => {
    const term = termRef.current;
    if (conn !== "open" || !term) return;
    term.reset();
    asked.current = fitModeRef.current ? size() : null;
    setForeign(false);
    link.send({ t: "open", pane: pane.id, fit: asked.current });
  }, [conn, pane.id]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = font;
    store.set("rm.font", String(font));
    layout();
  }, [font, layout]);

  useEffect(() => {
    store.set("rm.mode", fitMode ? "fit" : "mirror");
    layout();
  }, [fitMode, layout]);

  return (
    <div className="rm-pane">
      <header className="rm-bar">
        <button className="rm-icon" onClick={onBack} aria-label="Back to panes">
          <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden>
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="rm-pane-title">
          <span className={`glyph ${pane.status}`} role="img" aria-label={LABEL[pane.status] ?? pane.status} />
          <span className="rm-ellipsis">
            {pane.title}
            {pane.where && <span className="rm-row-where"> · {pane.where}</span>}
          </span>
        </span>
        <ConnDot conn={conn} />
        <button className="rm-icon" onClick={() => setMenu((m) => !m)} aria-label="Pane options" aria-expanded={menu}>
          <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden>
            <circle cx="5" cy="12" r="1.8" fill="currentColor" />
            <circle cx="12" cy="12" r="1.8" fill="currentColor" />
            <circle cx="19" cy="12" r="1.8" fill="currentColor" />
          </svg>
        </button>
      </header>
      {menu && (
        <div className="rm-menu">
          <div className="rm-seg" role="group" aria-label="Terminal size">
            <button className={fitMode ? "on" : ""} onClick={() => setFitMode(true)}>
              Fit phone
            </button>
            <button className={!fitMode ? "on" : ""} onClick={() => setFitMode(false)}>
              Desktop size
            </button>
          </div>
          <div className="rm-seg" role="group" aria-label="Text size">
            <button onClick={() => setFont((f) => Math.max(8, f - 1))} aria-label="Smaller text">
              A−
            </button>
            <span className="num">{font}</span>
            <button onClick={() => setFont((f) => Math.min(20, f + 1))} aria-label="Larger text">
              A+
            </button>
          </div>
          <button
            className={`rm-btn danger${confirmClose ? " armed" : ""}`}
            onClick={() => {
              if (!confirmClose) return setConfirmClose(true);
              link.send({ t: "action", action: { kind: "close", pane: pane.id } });
              onBack();
            }}
          >
            {confirmClose ? "Tap again to close it on your Mac" : "Close pane"}
          </button>
        </div>
      )}
      {pane.status === "needs_input" && pane.message && <div className="rm-ask">{pane.message}</div>}
      {pane.permission && <Approve pane={pane} />}
      {foreign && (
        <button
          className="rm-foreign"
          onClick={() => {
            layout();
            link.send({ t: "claim" });
          }}
        >
          Sized for another screen · <strong>Fit to this phone</strong>
        </button>
      )}
      <div className="rm-term-wrap">
        <div className={`rm-term${fitMode && !foreign ? "" : " mirror"}`} ref={host} />
        {ended && <div className="rm-ended">Session ended</div>}
      </div>
      <Keys />
      <Composer />
    </div>
  );
}

function Keys() {
  return (
    <div className="rm-keys" role="toolbar" aria-label="Keys">
      {KEYS.map((k) => (
        <button
          key={k.aria}
          aria-label={k.aria}
          // Keep the keyboard up: don't take focus from the composer.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => link.type(k.seq)}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}

function Composer() {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    if (text) {
      // Multi-line text goes in as one paste so a TUI doesn't submit at the first newline.
      link.type(text.includes("\n") ? `\x1b[200~${text}\x1b[201~` : text);
      // Separately, so Claude Code takes it as Enter rather than part of a paste.
      setTimeout(() => link.type("\r"), 40);
    } else link.type("\r");
    setText("");
  };

  useEffect(() => {
    const a = area.current;
    if (!a) return;
    a.style.height = "auto";
    a.style.height = `${Math.min(a.scrollHeight, 120)}px`;
  }, [text]);

  return (
    <form
      className="rm-compose"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        ref={area}
        value={text}
        rows={1}
        placeholder="Message or command"
        enterKeyHint="send"
        autoCapitalize="sentences"
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button type="submit" className="rm-send" aria-label="Send">
        <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden>
          <path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  );
}
