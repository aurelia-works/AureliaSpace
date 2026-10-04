/* AureliaSpace launch video.
 *
 * Every frame is a pure function of time: one paused GSAP timeline tweens a clock
 * from 0 to DUR, and its setter calls render(t). Layout, terminal output, camera and
 * cursor are all derived from t, so any seek order renders the same frame.
 *
 * The same script drives both cuts; <html data-orient="portrait"> switches the
 * app window to a tall 2-column layout and re-frames the camera.
 */
(function () {
  const PORTRAIT = document.documentElement.dataset.orient === "portrait";
  const COMP = PORTRAIT ? "vertical" : "main";
  const CW = PORTRAIT ? 1080 : 1920;
  const CH = PORTRAIT ? 1920 : 1080;
  const WIN_W = PORTRAIT ? 1040 : 1600;
  const WIN_H = PORTRAIT ? 1480 : 900;
  const S = PORTRAIT ? 1.0 : 0.972; // window scale on the canvas
  const WX = (CW - WIN_W * S) / 2;
  const WY = PORTRAIT ? 150 : 500 - (WIN_H * S) / 2;
  const CX = CW / 2;
  const CY = WY + (WIN_H * S) / 2;
  const COLS = PORTRAIT ? 2 : 3;
  const ROWS = 3;
  const DUR = 50;
  const Z = PORTRAIT
    ? { pill: 2.1, pane: 1.95, hdr: 2.05, modal: 1.05, drop: 1.95, link: 2.15, usage: 2.5 }
    : { pill: 2.5, pane: 2.15, hdr: 2.6, modal: 1.3, drop: 2.0, link: 2.3, usage: 2.9 };

  // ---------- helpers ----------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const EASES = {};
  const ez = (name) => (EASES[name] ||= gsap.parseEase(name));
  const prog = (t, a, d, e = "power3.out") => (d <= 0 ? (t >= a ? 1 : 0) : ez(e)(clamp((t - a) / d)));
  /** 0→1 over [a, a+fin], 1→0 over [b-fout, b]. */
  const span = (t, a, b, fin = 0.5, fout = 0.4) => Math.min(prog(t, a, fin, "power2.out"), 1 - prog(t, b - fout, fout, "power2.inOut"));
  const hash = (a, b) => {
    const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const fx = (n) => +n.toFixed(3);

  function h(tag, cls, html) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  }
  function css(el, prop, v) {
    const c = (el._c ||= {});
    if (c[prop] !== v) {
      c[prop] = v;
      el.style[prop] = v;
    }
  }
  const op = (el, v) => css(el, "opacity", String(fx(clamp(v))));
  function txt(el, v) {
    if (el._t !== v) {
      el._t = v;
      el.textContent = v;
    }
  }
  function cls(el, v) {
    if (el._k !== v) {
      el._k = v;
      el.className = v;
    }
  }
  function show(el, on) {
    const hid = !on;
    if (el._h !== hid) {
      el._h = hid;
      el.hidden = hid;
    }
  }

  // ---------- icons (src/components/Icons.tsx) ----------
  const svg = (inner, w = 14) =>
    `<svg width="${w}" height="${w}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const I = {
    close: svg('<path d="M4 4l8 8M12 4l-8 8"/>', 11),
    plus: svg('<path d="M8 3v10M3 8h10"/>'),
    spark: svg('<path d="M8 1.8l1.5 4.2 4.3 1.6-4.3 1.6L8 13.4 6.5 9.2 2.2 7.6l4.3-1.6z"/>'),
    grid: svg('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M8 2.5v11M2 8h12"/>'),
    folder: svg('<path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>'),
    diff: svg('<path d="M5 2.5v6M2 5.5h6M8 11.5h6"/>'),
    panel: svg('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M10 2.5v11"/>'),
    gear: svg('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>'),
    branch: svg('<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5.5" r="1.5"/><path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-6.5 4.2"/>', 11),
  };
  const POINTER =
    '<svg width="17" height="25" viewBox="0 0 17 25"><path d="M1.5 1.5 L1.5 19.6 L5.9 15.4 L9.1 22.7 L12.1 21.4 L8.9 14.3 L14.9 14.3 Z" fill="#0b0b0e" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';

  // ---------- story data ----------
  const ACCTS = ["work", "personal", "client"];
  // 5h / 7d usage per account: [before, after] the refresh in the usage shot.
  const USAGE = {
    work: { h5: [46, 73], d7: [22, 25] },
    personal: { h5: [18, 31], d7: [9, 11] },
    client: { h5: [7, 14], d7: [3, 4] },
  };

  // Line codes: "u:" user prompt, "s:" Claude text (streams in), "t:Name|arg" tool call,
  // "r:" tool result, "k:" green tool result. `code` and [[path:line]] are inline marks.
  const PANES = [
    {
      repo: "storefront", wt: "fix-login", verb: "Pondering",
      prompt: "fix the login redirect loop after OAuth",
      lines: [
        [13.95, "s:I'll trace the OAuth callback flow first."],
        [14.9, "t:Read|src/auth.ts"], [15.35, "r:Read 142 lines"],
        [16.3, "t:Read|src/login.tsx"], [16.75, "r:Read 88 lines"],
        [18.4, "s:The callback redirects to `next` before the session is stored, so the route guard sends you back to /login."],
        [20.2, "t:Edit|src/login.tsx"], [20.7, "r:Updated src/login.tsx with 6 additions and 2 removals"],
        [22.4, "t:Bash|npm test -- auth"], [27.5, "k:Tests: 14 passed, 14 total"],
        [28.3, "s:Fixed. The callback now waits for the session, and `next` must be a same-site path."],
        [36.05, "u:Review comments on the uncommitted changes. Please address each one:\n\n1. src/login.tsx:22\n   > router.push(safe);\n   Use router.replace so Back doesn't land on the callback again."],
        [36.8, "s:Good catch. Switching to `router.replace` so the callback never sits in history."],
        [37.9, "t:Edit|src/login.tsx"], [38.4, "r:Updated src/login.tsx with 1 addition and 1 removal"],
        [41.2, "t:Bash|npm test -- auth"], [44.6, "k:Tests: 14 passed, 14 total"],
      ],
    },
    {
      repo: "storefront", wt: "cart-tests", verb: "Thinking",
      prompt: "add tests for cart totals with discounts",
      lines: [
        [14.2, "t:Read|src/cart/totals.ts"], [14.65, "r:Read 64 lines"],
        [15.6, "t:Write|src/cart/totals.test.ts"], [16.05, "r:Wrote 58 lines to src/cart/totals.test.ts"],
        [17.3, "t:Bash|npm test -- cart"],
        [23.55, "k:Tests: 9 passed, 9 total"],
        [25.1, "s:All 9 pass, including stacked percentage and fixed-amount discounts."],
        [27.0, "t:Edit|src/cart/totals.ts"], [27.45, "r:Updated src/cart/totals.ts with 2 additions and 2 removals"],
        [30.2, "t:Bash|npm run lint"], [31.9, "r:No problems found"],
        [34.5, "s:Rounding now happens once, after discounts, which fixes the off-by-a-cent total."],
      ],
    },
    {
      repo: "api", wt: "rate-limit", verb: "Percolating",
      prompt: "add per-key rate limiting to /v1/orders",
      lines: [
        "s:Let me see how middleware is wired up.",
        't:Search|pattern: "rateLimit", path: "src"', "r:Found 3 files",
        "t:Read|src/middleware/index.ts", "r:Read 41 lines",
        "t:Write|src/middleware/rate-limit.ts", "r:Wrote 37 lines to src/middleware/rate-limit.ts",
        "t:Edit|src/routes/orders.ts", "r:Updated src/routes/orders.ts with 3 additions",
        "t:Bash|npm test -- orders", "k:Tests: 22 passed, 22 total",
        "s:Each API key gets 60 requests a minute, with `Retry-After` on 429s.",
      ],
    },
    {
      repo: "blog", wt: "rss-feed", verb: "Brewing",
      prompt: "generate an RSS feed for posts",
      lines: [
        "t:Read|astro.config.mjs", "r:Read 22 lines",
        "t:Read|src/content/config.ts", "r:Read 30 lines",
        "t:Write|src/pages/rss.xml.ts", "r:Wrote 31 lines to src/pages/rss.xml.ts",
        "t:Bash|npm run build", "k:Built 48 pages in 3.2s",
        "s:The feed is live at `/rss.xml` with the 20 most recent posts.",
        "t:Edit|src/layouts/Base.astro", "r:Updated src/layouts/Base.astro with 1 addition",
      ],
    },
    {
      repo: "blog", wt: "og-images", verb: "Mulling",
      prompt: "render OG images at build time",
      done: "Done. Each post gets a 1200×630 card in `dist/og/` at build.",
      lines: [
        't:Search|pattern: "og:image"', "r:Found 2 files",
        "t:Read|src/layouts/Post.astro", "r:Read 57 lines",
        "t:Write|src/lib/og.ts", "r:Wrote 44 lines to src/lib/og.ts",
        "t:Edit|src/layouts/Post.astro", "r:Updated src/layouts/Post.astro with 4 additions and 1 removal",
        "t:Bash|npm run build", "k:Built 48 pages in 4.1s",
      ],
    },
    {
      repo: "tally-cli", wt: "json-flag", verb: "Noodling",
      prompt: "add a --json flag to the report command",
      done: "Done. `tally report --json` prints machine-readable output.",
      lines: [
        "t:Read|src/commands/report.ts", "r:Read 73 lines",
        "t:Edit|src/commands/report.ts", "r:Updated src/commands/report.ts with 9 additions and 1 removal",
        "t:Bash|npm test", "k:Tests: 31 passed, 31 total",
      ],
    },
    {
      repo: "dashboard", wt: "chart-export", verb: "Cogitating",
      prompt: "fix the crash when exporting empty charts",
      lines: [
        "t:Read|src/app.ts", "r:Read 120 lines",
        "t:Read|src/export/png.ts", "r:Read 66 lines",
        "s:Found it: [[src/app.ts:42]] reads `series[0].points` before checking the chart has data.",
        "t:Edit|src/app.ts", "r:Updated src/app.ts with 3 additions and 1 removal",
        "t:Bash|npm test -- export", "k:Tests: 17 passed, 17 total",
        "s:Empty charts now export a blank frame instead of throwing.",
      ],
    },
    {
      repo: "dashboard", wt: "i18n-dates", verb: "Ruminating",
      prompt: "localize date formats in reports",
      lines: [
        't:Search|pattern: "toLocaleDateString"', "r:Found 7 files",
        "t:Read|src/reports/format.ts", "r:Read 38 lines",
        "s:I'll route every date through one `formatDate` helper that takes the user's locale.",
        "t:Edit|src/reports/format.ts", "r:Updated src/reports/format.ts with 5 additions and 4 removals",
        "t:Edit|src/reports/table.tsx", "r:Updated src/reports/table.tsx with 2 additions and 2 removals",
      ],
    },
    {
      repo: "mobile-api", wt: "webhooks", verb: "Computing",
      prompt: "retry failed webhooks with backoff",
      lines: [
        "t:Read|src/webhooks/deliver.ts", "r:Read 95 lines",
        "t:Edit|src/webhooks/deliver.ts", "r:Updated src/webhooks/deliver.ts with 18 additions and 3 removals",
        "t:Bash|npm test -- webhooks", "k:Tests: 12 passed, 12 total",
        "s:Failed deliveries retry 5 times with exponential backoff and jitter.",
        "t:Write|src/webhooks/README.md", "r:Wrote 24 lines to src/webhooks/README.md",
      ],
    },
  ];

  const VISIBLE = PORTRAIT ? [0, 1, 3, 4, 6, 7] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const NEED = 1;
  const DONE = PORTRAIT ? 4 : 5;
  const DROP = 3;
  const LINK = 6;
  const USAGE_PANES = PORTRAIT ? [1, 4, 7] : [2, 5, 8];
  const T_NEED = 18.0, T_ANSWER = 23.1, T_DONE = 17.6;
  const T_FOCUS = [[0, 0], [21.25, NEED], [29.3, 0], [38.0, DROP], [39.55, LINK]];

  /** Builds the scene into the composition root and returns its frame renderer. */
  function build(root) {
    // ---------- DOM ----------
    const stage = root;
    const scene = h("div", "clip");
    scene.id = "scene";
    scene.dataset.start = "0";
    scene.dataset.duration = String(DUR);
    scene.dataset.trackIndex = "0";
    // UI truncation, captions over the scrim and overlays on the app are intentional.
    scene.setAttribute("data-layout-allow-overlap", "");
    scene.setAttribute("data-layout-allow-occlusion", "");
    stage.appendChild(scene);
    if (PORTRAIT) stage.classList.add("portrait");

    scene.appendChild(h("div", "backdrop"));
    const cam = h("div");
    cam.id = "cam";
    scene.appendChild(cam);
    scene.appendChild(h("div", "vignette"));

    // App window
    const app = h("div", "app");
    css(app, "width", WIN_W + "px");
    css(app, "height", WIN_H + "px");
    cam.appendChild(app);

    // Tab bar
    const tabbar = h("div", "tabbar");
    tabbar.appendChild(h("div", "lights", "<i></i><i></i><i></i>"));
    const tabs = h("div", "tabs");
    const tab1 = h("div", "tab active");
    const tab1Dot = h("span", "status-dot idle");
    const tab1Acct = h("span", "tab-account", "work");
    const tab1Title = h("span", "tab-title", "fix-login");
    const tab1Count = h("span", "tab-count", "9");
    const tab1Close = h("span", "tab-close", I.close);
    tab1.append(tab1Dot, tab1Acct, tab1Title, tab1Count, tab1Close);
    const tab2 = h("div", "tab", `<span class="status-dot shell"></span><span class="tab-title">notes</span><span class="tab-close">${I.close}</span>`);
    const btnGrid = h("span", "icon-btn tab-new", I.grid);
    tabs.append(tab1, tab2, h("span", "icon-btn tab-new", I.plus), h("span", "icon-btn tab-new claude", I.spark), btnGrid);
    const right = h("div", "tabbar-right");
    const pill = h("span", "waiting-pill urgent");
    const pillText = h("span", null, "2 waiting");
    pill.append(pillText, h("kbd", null, "⌘J"));
    const btnDiff = h("span", "icon-btn", I.diff);
    right.append(pill, h("span", "icon-btn", I.folder), btnDiff, h("span", "icon-btn", I.panel), h("span", "icon-btn", I.gear));
    tabbar.append(tabs, right);
    app.appendChild(tabbar);

    const workspace = h("div", "workspace");
    const content = h("div", "tab-content");
    workspace.appendChild(content);
    app.appendChild(workspace);

    // Inline marks: `code` and [[link]]
    function segments(s) {
      const out = [];
      const re = /`([^`]+)`|\[\[([^\]]+)\]\]/g;
      let i = 0, m;
      while ((m = re.exec(s))) {
        if (m.index > i) out.push({ t: s.slice(i, m.index), c: "" });
        out.push(m[1] != null ? { t: m[1], c: "code" } : { t: m[2], c: "link" });
        i = re.lastIndex;
      }
      if (i < s.length) out.push({ t: s.slice(i), c: "" });
      return out;
    }

    function buildLine(pane, code) {
      const kind = code[0];
      const body = code.slice(2);
      const ln = h("div", "ln");
      const L = { el: ln, kind, segs: [], len: 0, stream: kind === "s" };
      if (kind === "u") {
        ln.classList.add("blk", "user");
        ln.append(h("span", "bul", "&gt;"));
        const tx = h("span", "tx");
        tx.textContent = body;
        ln.append(tx);
      } else if (kind === "t") {
        ln.classList.add("blk");
        const [name, arg] = body.split("|");
        ln.append(h("span", "bul tool", "●"));
        const tx = h("span", "tx");
        tx.append(h("span", "tool-name", name), document.createTextNode(`(${arg})`));
        ln.append(tx);
      } else if (kind === "r" || kind === "k") {
        ln.classList.add("res");
        ln.append(h("span", "el", "⎿"));
        const tx = h("span", "tx" + (kind === "k" ? " ok" : ""));
        tx.textContent = body;
        ln.append(tx);
      } else {
        ln.classList.add("blk");
        ln.append(h("span", "bul say", "●"));
        const tx = h("span", "tx");
        for (const sg of segments(body)) {
          const sp = h("span", sg.c || null);
          if (sg.c === "link") pane.linkEl = sp;
          tx.appendChild(sp);
          L.segs.push({ el: sp, t: sg.t });
          L.len += sg.t.length;
        }
        ln.append(tx);
      }
      return L;
    }

    const panes = [];
    VISIBLE.forEach((i, k) => {
      const d = PANES[i];
      const acct = ACCTS[Math.floor(k / COLS)];
      const p = { i, k, d, acct, col: k % COLS, row: Math.floor(k / COLS) };
      p.T0 = 12.25 + 0.16 * k;
      p.cwd = `~/dev/${d.repo}.worktrees/${d.wt}`;

      const el = h("div", "pane");
      const header = h("div", "pane-header");
      const title = h("div", "pane-title");
      p.dot = h("span", "status-dot starting");
      p.chip = h("span", "account-chip", acct);
      p.path = h("span", "pane-path");
      p.path.textContent = "\u200e" + p.cwd + "\u200e"; // keep "~/" leading inside the rtl ellipsis
      p.git = h("span", "git-chip", `${I.branch}aurelia/${d.wt}<span class="wt">worktree</span>`);
      p.badge = h("span", "agent-badge working", "working");
      title.append(p.dot, p.chip, p.path, p.git, p.badge);
      const actions = h("div", "pane-actions");
      p.usage = h("span", "usage compact");
      p.meters = ["5h", "7d"].map((lab) => {
        const m = h("span", "meter");
        const fill = h("span", "meter-fill");
        const track = h("span", "meter-track");
        track.appendChild(fill);
        const val = h("span", "meter-value");
        m.append(h("span", "meter-label", lab), track, val);
        p.usage.appendChild(m);
        return { fill, val };
      });
      actions.appendChild(p.usage);
      header.append(title, actions);

      const body = h("div", "pane-body");
      const term = h("div", "term");
      body.appendChild(term);
      el.append(header, body);
      p.el = el;
      p.header = header;

      if (i === 0) {
        p.welcome = h(
          "div",
          "welcome",
          `<b>Welcome to Claude Code!</b>\n\n<span class="dim">  /help for help, /status for your current setup\n\n  cwd: ${p.cwd}</span>`
        );
        term.appendChild(p.welcome);
      }

      // Transcript
      p.lines = [];
      const user = buildLine(p, "u:" + d.prompt);
      user.at = p.T0;
      p.lines.push(user);
      let sched = d.lines.map((x) => (Array.isArray(x) ? { at: x[0], code: x[1] } : { code: x }));
      if (i === DONE) sched.push({ code: "s:" + d.done });
      // Fill in times for unscheduled lines; the DONE pane is squeezed to finish at T_DONE.
      let at = p.T0 + 0.7;
      sched.forEach((s, j) => {
        if (s.at != null) return (at = s.at);
        const res = s.code[0] === "r" || s.code[0] === "k";
        at += j === 0 ? 0 : res ? 0.45 + 0.3 * hash(i, j) : 1.3 + 1.5 * hash(i, j + 7);
        s.at = at;
      });
      if (i === DONE) {
        const a0 = sched[0].at, a1 = sched[sched.length - 1].at;
        sched.forEach((s) => (s.at = p.T0 + 0.7 + ((s.at - a0) / (a1 - a0)) * (T_DONE - p.T0 - 0.7)));
      }
      for (const s of sched) {
        const L = buildLine(p, s.code);
        L.at = s.at;
        p.lines.push(L);
      }
      p.lines.forEach((L) => term.appendChild(L.el));

      if (i === NEED) {
        p.perm = h(
          "div",
          "perm",
          `<div class="t">Bash command</div><div class="cmd">npm test -- cart</div><div class="d">Run the cart unit tests</div><div class="q">Do you want to proceed?</div><div class="o sel">❯ 1. Yes</div><div class="o">  2. Yes, and don't ask again for npm test commands</div><div class="o">  3. No, and tell Claude what to do differently (esc)</div>`
        );
        term.appendChild(p.perm);
      }
      p.spin = h("div", "spin");
      p.spinG = h("span", "g", "✶");
      p.spinVerb = h("span", "verb", d.verb + "…");
      p.spinRest = h("span", null, "");
      p.spin.append(p.spinG, p.spinVerb, p.spinRest);
      p.inbox = h("div", "inbox");
      p.inText = h("span", "typed", "");
      p.caret = h("span", "caret");
      const inWrap = h("span", "tx");
      inWrap.append(p.inText, p.caret);
      p.inbox.append(h("span", "pr", "&gt;"), inWrap);
      p.hint = h("div", "hint-line", "? for shortcuts");
      term.append(p.spin, p.inbox, p.hint);

      content.appendChild(el);
      panes.push(p);
    });
    const byIdx = Object.fromEntries(panes.map((p) => [p.i, p]));

    const ring = h("div", "ring");
    content.appendChild(ring);

    // Diff review modal
    const backdrop = h("div", "modal-backdrop");
    css(backdrop, "paddingTop", Math.round(WIN_H * 0.06) + "px");
    const modal = h("div", "modal review");
    css(modal, "width", Math.min(1100, WIN_W - 48) + "px");
    css(modal, "height", Math.round(WIN_H * 0.84) + "px");
    modal.innerHTML = `
      <div class="modal-head"><h2>Review changes <span class="hint inline">fix-login</span></h2><span class="link-btn">reload</span></div>
      <div class="review-body">
        <section class="diff-file">
          <header><span class="chev">▾</span><span class="diff-status">M</span><span class="diff-path">src/login.tsx</span><span class="diff-counts"><span class="add">+6</span> <span class="del">−2</span></span><span class="link-btn">comment on file</span></header>
          <div class="diff-lines" id="dl-login"></div>
        </section>
        <section class="diff-file">
          <header><span class="chev">▾</span><span class="diff-status">M</span><span class="diff-path">src/auth.ts</span><span class="diff-counts"><span class="add">+3</span> <span class="del">−1</span></span><span class="link-btn">comment on file</span></header>
          <div class="diff-lines" id="dl-auth"></div>
        </section>
        <section class="diff-file closed">
          <header><span class="chev">▸</span><span class="diff-status added">A</span><span class="diff-path">src/login.test.tsx</span><span class="diff-counts"><span class="add">+24</span> <span class="del">−0</span></span><span class="link-btn">comment on file</span></header>
        </section>
      </div>
      <div class="review-foot">
        <div class="ta"><span class="ph">Overall note (optional)</span></div>
        <div class="review-send"><span class="msg" id="rv-msg">0 comments · click a line to comment</span><span class="select">work · fix-login</span><span class="btn" id="rv-close">Close</span><span class="btn primary dis" id="rv-send">Send to Claude</span></div>
      </div>`;
    backdrop.appendChild(modal);
    app.appendChild(backdrop);

    const DIFF_LOGIN = [
      ["hunk", "", "@@ -16,9 +16,13 @@ export function LoginCallback() {"],
      ["ctx", 16, "  const router = useRouter();"],
      ["ctx", 17, "  const { session } = useSession();"],
      ["ctx", 18, '  const next = useSearchParams().get("next") ?? "/";'],
      ["del", 19, "  if (session) router.push(next);"],
      ["add", 19, "  useEffect(() => {"],
      ["add", 20, "    if (!session) return;"],
      ["add", 21, '    const safe = next.startsWith("/") ? next : "/";'],
      ["add", 22, "    router.push(safe);"],
      ["add", 23, "  }, [session, next]);"],
      ["ctx", 24, ""],
      ["ctx", 25, '  return <Spinner label="Signing you in…" />;'],
    ];
    const DIFF_AUTH = [
      ["hunk", "", "@@ -41,6 +41,8 @@ export async function handleCallback(code: string) {"],
      ["ctx", 41, "  const tokens = await exchangeCode(code);"],
      ["del", 42, "  setSession(tokens);"],
      ["add", 42, "  await setSession(tokens);"],
      ["add", 43, "  // Callers redirect only after the session is persisted."],
      ["add", 44, "  return tokens;"],
      ["ctx", 45, "}"],
    ];
    function fillDiff(host, rows) {
      const out = [];
      for (const [kind, ln, code] of rows) {
        const row = h("div", `diff-line ${kind}`);
        if (kind === "hunk") row.textContent = code;
        else {
          row.append(h("span", "ln", String(ln)), h("span", "sign", kind === "add" ? "+" : kind === "del" ? "−" : " "));
          const c = h("span", "code");
          c.textContent = code || " ";
          row.append(c, h("span", "add-comment", "+"));
        }
        host.appendChild(row);
        out.push(row);
      }
      return out;
    }
    fillDiff(modal.querySelector("#dl-login"), DIFF_LOGIN);
    fillDiff(modal.querySelector("#dl-auth"), DIFF_AUTH);
    const loginRows = modal.querySelectorAll("#dl-login .diff-line");
    const targetRow = loginRows[8]; // "router.push(safe);"
    const COMMENT = "Use router.replace so Back doesn't land on the callback again.";
    const cEdit = h("div", "diff-comment-edit");
    const cTa = h("div", "ta");
    const cTyped = h("span", null, "");
    const cPh = h("span", "ph", "What should Claude change here?  ⌘↵ save · Esc cancel");
    const cCaret = h("span", "caret");
    cTa.append(cTyped, cCaret, cPh);
    const cActs = h("div", "diff-comment-actions");
    const cCancel = h("span", "btn", "Cancel");
    const cSave = h("span", "btn primary", "Save");
    cActs.append(cCancel, cSave);
    cEdit.append(cTa, cActs);
    const cSaved = h("div", "diff-comment", COMMENT);
    targetRow.after(cEdit, cSaved);
    const rvMsg = modal.querySelector("#rv-msg");
    const rvSend = modal.querySelector("#rv-send");

    const toast = h("div", "toast", "Sent 1 comment to Claude");
    app.appendChild(toast);

    const ghost = h("div", "ghost", `<span class="thumb"></span><span>hero shot.png</span><span class="plus">+</span>`);
    app.appendChild(ghost);
    const pointer = h("div", "pointer", POINTER);
    app.appendChild(pointer);

    // Hook
    const hook = h("div", "hook");
    const hookText = h("div", "hook-text");
    const HOOK1 = "Running 6 Claude Code agents?";
    const HOOK2 = "Lost track of which one needs you?";
    const h1 = h("span", "l1");
    const h2 = h("span", "l2");
    const hCur = h("span", "cur");
    hookText.append(h1, document.createTextNode("\n"), h2);
    hook.appendChild(hookText);
    scene.appendChild(hook);

    // Logo card
    const logo = h("div", "card");
    const logoMark = h("img", "mark");
    logoMark.src = "assets/logo.svg";
    logoMark.alt = "";
    const logoWord = h("div", "wordmark", "AureliaSpace");
    const logoTag = h("div", "tagline", "A terminal built for running Claude Code agents side by side.");
    logo.append(logoMark, logoWord, logoTag);
    scene.appendChild(logo);

    // Outro
    const outro = h("div", "card outro");
    const oMark = h("img", "mark");
    oMark.src = "assets/logo.svg";
    oMark.alt = "";
    const oWord = h("div", "wordmark", "AureliaSpace");
    const oFree = h("div", "free", "Free on GitHub");
    const oUrl = h("div", "url", "github.com/aurelia-works/AureliaSpace");
    const oPlat = h("div", "plat", "macOS · Apple silicon");
    const oFine = h("div", "fine", "Built for Claude Code. Not affiliated with Anthropic.");
    outro.append(oMark, oWord, oFree, oUrl, oPlat, oFine);
    scene.appendChild(outro);

    // Captions + keycaps (screen space)
    const capBox = h("div", "captions");
    const scrim = h("div", "scrim");
    css(scrim, "height", (PORTRAIT ? 420 : 250) + "px");
    scene.appendChild(scrim);
    css(capBox, "bottom", (PORTRAIT ? 130 : 46) + "px");
    scene.appendChild(capBox);
    const CAPS = [
      [12.7, 16.9, "Split into a grid. One agent per pane."],
      [18.7, 23.9, 'See who needs you. Jump there with <span class="k">⌘J</span>.'],
      [24.6, 29.7, "Every agent on its own branch."],
      [30.9, 35.8, "Review the diff. Send notes straight to Claude."],
      [37.1, 38.65, "Drop a file in, get its path."],
      [38.8, 40.35, '<span class="k">⌘</span>-click a path to open it.'],
      [40.5, 41.95, "Usage per account, at a glance."],
    ].map(([a, b, html]) => {
      const el = h("div", "cap", html);
      capBox.appendChild(el);
      return { a, b, el };
    });

    const hud = h("div", "hud");
    css(hud, "bottom", (PORTRAIT ? 330 : 150) + "px");
    scene.appendChild(hud);
    const KEYS = [
      [10.2, 11.25, ["⌘", "G"]],
      [20.8, 21.85, ["⌘", "J"]],
      [22.7, 23.45, ["1"]],
      [30.15, 31.2, ["⇧", "⌘", "R"]],
      [39.0, 40.25, ["⌘"]],
    ].map(([a, b, keys]) => {
      const el = h("div", "keys");
      for (const k of keys) el.appendChild(h("div", "key" + ("⌘⇧".includes(k) ? " mod" : ""), k));
      hud.appendChild(el);
      return { a, b, el };
    });

    const fadeBlack = h("div", "clip");
    css(fadeBlack, "background", "#000");
    scene.appendChild(fadeBlack);

    // ---------- geometry ----------
    const AW = WIN_W - 12;
    const AH = WIN_H - 40 - 12;
    const GAP = 6;
    const cellW = (AW - (COLS - 1) * GAP) / COLS;
    const cellH = (AH - (ROWS - 1) * GAP) / ROWS;

    function paneRect(p, pc, pr) {
      const xs = [];
      for (let c = 0; c <= COLS; c++) xs.push(c === 0 ? 0 : c === COLS ? AW + GAP : lerp(AW + GAP, c * (cellW + GAP), pc));
      const ys = [];
      for (let r = 0; r <= ROWS; r++) ys.push(r === 0 ? 0 : r === ROWS ? AH + GAP : lerp(AH + GAP, r * (cellH + GAP), pr));
      const x = xs[p.col], y = ys[p.row];
      return { x: 6 + x, y: 6 + y, w: xs[p.col + 1] - GAP - x, h: ys[p.row + 1] - GAP - y };
    }
    const finalRect = (p) => paneRect(p, 1, 1);

    /** Rect of an element in app-window coordinates (independent of camera). */
    function lr(el) {
      const a = app.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const k = a.width / WIN_W || 1;
      return { x: (r.left - a.left) / k, y: (r.top - a.top) / k, w: r.width / k, h: r.height / k };
    }
    const worldOf = (x, y) => ({ x: WX + S * x, y: WY + S * y });

    // Camera states are { fx, fy, s }: world point at the frame's centre, and zoom.
    const FULL = (s = 1) => () => ({ fx: CX, fy: CY, s });
    const ON = (getEl, s, ox = 0, oy = 0) => () => {
      const el = typeof getEl === "function" ? getEl() : getEl;
      const r = lr(el);
      if (!r.w || !r.h) return null; // not laid out (hidden); keep the previous framing
      const w = worldOf(r.x + r.w / 2 + ox, r.y + r.h / 2 + oy);
      return { fx: w.x, fy: w.y, s };
    };
    const hdrOf = (i) => () => byIdx[i].header;
    const paneOf = (i) => () => byIdx[i].el;
    const rowTop = panes.filter((p) => p.row === 0);
    const CAM = [
      [0, 0, FULL(1)],
      [12.4, 5.2, FULL(1.045), "sine.inOut"],
      [18.45, 1.3, ON(pill, Z.pill, PORTRAIT ? -150 : -170, PORTRAIT ? 120 : 95), "power3.inOut"],
      [20.3, 1.0, FULL(1), "power3.inOut"],
      [21.65, 1.25, ON(paneOf(NEED), Z.pane), "power3.inOut"],
      [24.0, 1.3, ON(hdrOf(rowTop[0].i), Z.hdr, PORTRAIT ? 10 : -20, PORTRAIT ? 120 : 95), "power3.inOut"],
      [25.5, 3.1, ON(hdrOf(rowTop[rowTop.length - 1].i), Z.hdr, PORTRAIT ? -10 : 20, PORTRAIT ? 120 : 95), "sine.inOut"],
      [28.85, 1.3, FULL(1), "power3.inOut"],
      [30.85, 1.25, ON(modal, Z.modal, 0, PORTRAIT ? 0 : -6), "power3.inOut"],
      [35.95, 0.95, ON(paneOf(0), Z.pane), "power3.inOut"],
      [37.0, 0, ON(paneOf(DROP), Z.drop)],
      [37.0, 1.7, ON(paneOf(DROP), Z.drop * 1.045), "none"],
      [38.7, 0, ON(() => byIdx[LINK].linkEl, Z.link, PORTRAIT ? 60 : 90, PORTRAIT ? -30 : -40)],
      [38.7, 1.7, ON(() => byIdx[LINK].linkEl, Z.link * 1.045, PORTRAIT ? 60 : 90, PORTRAIT ? -30 : -40), "none"],
      [40.4, 0, ON(() => byIdx[USAGE_PANES[0]].usage, Z.usage, PORTRAIT ? -95 : -140, 0)],
      [40.5, 1.4, ON(() => byIdx[USAGE_PANES[2]].usage, Z.usage, PORTRAIT ? -95 : -140, 0), "sine.inOut"],
      [42.0, 0, FULL(1.12)],
      [42.0, 2.8, FULL(0.9), "power3.inOut"],
    ];

    function cameraAt(t) {
      let cur = CAM[0][2]();
      for (const [a, d, target, e] of CAM) {
        if (t < a) break;
        const to = target() || cur;
        if (d <= 0 || t >= a + d) {
          cur = to;
          continue;
        }
        const p = ez(e)((t - a) / d);
        // Zoom geometrically so pushes feel even; pan linearly in focus space.
        cur = { fx: lerp(cur.fx, to.fx, p), fy: lerp(cur.fy, to.fy, p), s: cur.s * Math.pow(to.s / cur.s, p) };
        break;
      }
      return cur;
    }

    /** Piecewise pointer path in window coords: [start, dur, getPoint, ease]. */
    function pathAt(t, keys) {
      let cur = keys[0][2]();
      for (const [a, d, pt, e] of keys) {
        if (t < a) break;
        const to = pt();
        if (d <= 0 || t >= a + d) {
          cur = to;
          continue;
        }
        const p = ez(e || "power3.inOut")((t - a) / d);
        cur = { x: lerp(cur.x, to.x, p), y: lerp(cur.y, to.y, p) };
        break;
      }
      return cur;
    }
    const at = (getEl, fx_ = 0.5, fy_ = 0.5, ox = 0, oy = 0) => () => {
      const r = lr(typeof getEl === "function" ? getEl() : getEl);
      return { x: r.x + r.w * fx_ + ox, y: r.y + r.h * fy_ + oy };
    };

    // Hook typing with a little human unevenness.
    function typeTimes(text, a, b, seed) {
      const w = [...text].map((ch, i) => (ch === " " ? 1.5 : 0.7) + 0.6 * hash(i, seed));
      const tot = w.reduce((x, y) => x + y, 0);
      let acc = 0;
      return w.map((x) => (acc += x) / tot).map((f) => a + f * (b - a));
    }
    const HT1 = typeTimes(HOOK1, 0.45, 1.75, 1);
    const HT2 = typeTimes(HOOK2, 2.55, 3.95, 2);
    const typed = (text, times, t) => {
      let n = 0;
      while (n < times.length && t >= times[n]) n++;
      return text.slice(0, n);
    };

    function statusOf(p, t) {
      if (p.i === 0) return t < p.T0 ? "idle" : t < 28.3 ? "working" : t < 36.05 ? "idle" : "working";
      if (t < p.T0) return "starting";
      if (p.i === NEED && t >= T_NEED && t < T_ANSWER) return "needs_input";
      if (p.i === DONE && t >= T_DONE) return "idle";
      return "working";
    }
    const attention = (p, t) => p.i === DONE && t >= T_DONE;
    const LABEL = { starting: "starting", working: "working", needs_input: "needs input" };

    function focusAt(t) {
      let from = 0, to = 0, since = -10;
      for (const [a, i] of T_FOCUS) {
        if (t < a) break;
        from = to;
        to = i;
        since = a;
      }
      return { from, to, since };
    }

    function usageAt(acct, which, t) {
      const [a, b] = USAGE[acct][which];
      const row = ACCTS.indexOf(acct);
      return lerp(a, b, prog(t, 40.55 + 0.42 * row, 0.85, "power2.inOut"));
    }

    const SPIN = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];

    // ---------- render ----------
    function render(t) {
      // Hook (0–5s)
      const hookOn = t < 5.05;
      show(hook, hookOn);
      if (hookOn) {
        txt(h1, typed(HOOK1, HT1, t));
        txt(h2, typed(HOOK2, HT2, t));
        const onLine2 = t >= 2.4;
        (onLine2 ? h2 : h1).after(hCur);
        const typing = (t > 0.4 && t < 1.8) || (t > 2.5 && t < 4.0);
        const blink = typing || Math.floor((t - 0.2) / 0.53) % 2 === 0;
        op(hCur, (t > 0.25 ? 1 : 0) * (blink ? 1 : 0));
        css(h1, "color", t < 2.3 ? "var(--text)" : "var(--text-dim)");
        op(hook, 1 - prog(t, 4.55, 0.45, "power2.inOut"));
      }

      // Logo (5–10s)
      const logoOn = t > 4.9 && t < 10.2;
      show(logo, logoOn);
      if (logoOn) {
        const m = prog(t, 5.1, 1.1, "expo.out");
        op(logoMark, m);
        css(logoMark, "transform", `scale(${fx(0.9 + 0.1 * m)})`);
        const w = prog(t, 5.4, 1.0, "power3.out");
        op(logoWord, w);
        css(logoWord, "transform", `translateY(${fx(18 * (1 - w))}px)`);
        const g = prog(t, 6.15, 0.9, "power3.out");
        op(logoTag, g);
        css(logoTag, "transform", `translateY(${fx(12 * (1 - g))}px)`);
        const out = prog(t, 9.05, 0.65, "power3.in");
        op(logo, 1 - out);
        css(logo, "transform", `translateY(${fx(-26 * out)}px)`);
      }

      // App window
      const appOn = t > 9.3 && t < 45.6;
      show(cam, appOn);
      if (appOn) renderApp(t);

      // Outro
      const outOn = t > 44.6;
      show(outro, outOn);
      if (outOn) {
        const parts = [[oMark, 45.0], [oWord, 45.2], [oFree, 45.75], [oUrl, 46.0], [oPlat, 46.3], [oFine, 46.6]];
        for (const [el, a] of parts) {
          const p = prog(t, a, 0.9, "power3.out");
          op(el, p);
          css(el, "transform", el === oMark ? `scale(${fx(0.92 + 0.08 * p)})` : `translateY(${fx(14 * (1 - p))}px)`);
        }
      }

      // Captions, keycaps
      let capVis = 0;
      for (const c of CAPS) {
        const v = span(t, c.a, c.b, 0.5, 0.35);
        show(c.el, v > 0);
        if (v > 0) {
          op(c.el, v);
          css(c.el, "transform", `translateY(${fx(10 * (1 - prog(t, c.a, 0.6, "power3.out")))}px)`);
        }
        capVis = Math.max(capVis, v);
      }
      op(scrim, capVis * 0.9);
      for (const k of KEYS) {
        const v = span(t, k.a, k.b, 0.28, 0.3);
        show(k.el, v > 0);
        if (v > 0) {
          const press = Math.sin(clamp((t - k.a - 0.3) / 0.22) * Math.PI);
          op(k.el, v);
          css(k.el, "transform", `translate(-50%, ${fx(12 * (1 - prog(t, k.a, 0.35, "power3.out")) + 4 * press)}px)`);
        }
      }
      op(fadeBlack, prog(t, 49.35, 0.65, "power2.in"));
    }

    function renderApp(t) {
      // Window entrance
      const e = prog(t, 9.45, 1.0, "power3.out");
      const sE = S * (0.965 + 0.035 * e);
      const left = CX - (WIN_W * sE) / 2;
      const top = CY - (WIN_H * sE) / 2 + 46 * (1 - e);
      css(app, "transform", `translate(${fx(left)}px, ${fx(top)}px) scale(${fx(sE)})`);
      op(cam, e * (1 - prog(t, 44.55, 0.8, "power2.inOut")));

      // Grid split
      const pc = prog(t, 10.5, 1.05, "power3.inOut");
      const pr = prog(t, 11.15, 1.1, "power3.inOut");
      btnGrid.classList.toggle("press", t > 10.25 && t < 10.6);
      const f = focusAt(t);
      const pulse = (period) => 1 - 0.55 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period));
      let worst = "idle";
      let waiting = 0, urgent = false;
      const rank = { idle: 0, starting: 1, working: 2, needs_input: 3 };

      for (const p of panes) {
        const r = paneRect(p, pc, pr);
        const vis = r.w > 30 && r.h > 30;
        show(p.el, vis);
        if (!vis) continue;
        css(p.el, "left", fx(r.x) + "px");
        css(p.el, "top", fx(r.y) + "px");
        css(p.el, "width", fx(r.w) + "px");
        css(p.el, "height", fx(r.h) + "px");

        const st = statusOf(p, t);
        const att = attention(p, t);
        if (rank[st] > rank[worst]) worst = st;
        if (st === "needs_input" || att) waiting++;
        if (st === "needs_input") urgent = true;

        const focused = f.to === p.i;
        p.el.classList.toggle("focused", focused);
        p.el.classList.toggle("drop-target", p.i === DROP && t > 37.62 && t < 38.02);

        // Header
        cls(p.dot, `status-dot ${st}${att ? " attention" : ""}`);
        op(p.dot, st === "working" ? pulse(1.4) : st === "needs_input" ? pulse(0.9) : 1);
        const chipIn = p.i === 0 ? 1 : prog(t, 11.95 + 0.07 * p.k, 0.45, "back.out(1.6)");
        show(p.chip, chipIn > 0);
        op(p.chip, chipIn);
        css(p.chip, "transform", `scale(${fx(0.6 + 0.4 * chipIn)})`);
        const badge = st !== "idle" ? st : att ? "done" : null;
        show(p.badge, !!badge);
        if (badge) {
          cls(p.badge, `agent-badge ${badge}`);
          txt(p.badge, LABEL[badge] || "done");
        }
        ["h5", "d7"].forEach((w, j) => {
          const v = usageAt(p.acct, w, t);
          css(p.meters[j].fill, "width", fx(v) + "%");
          cls(p.meters[j].fill, "meter-fill " + (v >= 90 ? "crit" : v >= 70 ? "warn" : "ok"));
          txt(p.meters[j].val, Math.round(v) + "%");
        });

        // Transcript
        if (p.welcome) show(p.welcome, true);
        for (const L of p.lines) {
          const on = t >= L.at;
          show(L.el, on);
          if (on && L.stream) {
            const n = Math.floor(clamp((t - L.at) / (L.len / 95 + 0.15)) * L.len);
            let left = n;
            for (const sg of L.segs) {
              txt(sg.el, sg.t.slice(0, Math.max(0, left)));
              left -= sg.t.length;
            }
          }
        }
        if (p.linkEl) {
          const hot = t > 39.32 && t < 40.15;
          p.linkEl.className = "link" + (hot ? " hot" : "");
        }
        const perm = p.perm && st === "needs_input";
        if (p.perm) show(p.perm, perm);
        const working = st === "working";
        show(p.spin, working);
        if (working) {
          const since = p.i === 0 && t >= 36.05 ? 36.05 : p.i === NEED && t >= T_ANSWER ? T_ANSWER : p.T0;
          const secs = Math.max(0, Math.floor(t - since));
          const tok = (0.3 + secs * (0.09 + 0.05 * hash(p.i, 3))).toFixed(1);
          txt(p.spinG, SPIN[Math.floor(t * 8 + p.i * 3) % SPIN.length]);
          txt(p.spinRest, ` (${secs}s · ↑ ${tok}k tokens · esc to interrupt)`);
        }
        show(p.inbox, !perm);
        show(p.hint, !perm);
        txt(p.inText, p.i === DROP && t >= 38.02 ? "/Users/you/Desktop/hero\\ shot.png " : "");
        op(p.caret, focused && Math.floor(t / 0.53) % 2 === 0 ? 1 : 0);
      }

      // Tab bar
      const fp = byIdx[f.to];
      cls(tab1Dot, `status-dot ${worst}${waiting ? " attention" : ""}`);
      op(tab1Dot, worst === "working" ? pulse(1.4) : worst === "needs_input" ? pulse(0.9) : 1);
      txt(tab1Acct, fp.acct);
      txt(tab1Title, fp.d.wt);
      const count = panes.filter((p) => p.el._h === false).length;
      show(tab1Count, count > 1);
      txt(tab1Count, String(count));
      show(pill, waiting > 0);
      if (waiting > 0) {
        txt(pillText, `${waiting} waiting`);
        cls(pill, "waiting-pill" + (urgent ? " urgent" : ""));
        const pin = prog(t, T_DONE, 0.6, "power3.out");
        op(pill, pin);
        css(pill, "transform", `translateX(${fx(16 * (1 - pin))}px)`);
      }
      btnDiff.classList.toggle("press", t > 30.2 && t < 30.6);

      // Focus ring glides between panes
      const rTo = finalRect(byIdx[f.to]);
      const rFrom = finalRect(byIdx[f.from]);
      const g = prog(t, f.since, 0.75, "expo.inOut");
      const multi = prog(t, 11.7, 0.5, "power2.out");
      op(ring, multi);
      if (multi > 0) {
        css(ring, "left", fx(lerp(rFrom.x, rTo.x, g)) + "px");
        css(ring, "top", fx(lerp(rFrom.y, rTo.y, g)) + "px");
        css(ring, "width", fx(lerp(rFrom.w, rTo.w, g)) + "px");
        css(ring, "height", fx(lerp(rFrom.h, rTo.h, g)) + "px");
        const glow = Math.sin(clamp((t - f.since) / 1.1) * Math.PI) * (f.since > 1 ? 1 : 0);
        css(ring, "boxShadow", `0 0 ${fx(18 * glow)}px ${fx(2 * glow)}px rgba(233,176,75,${fx(0.28 * glow)})`);
      }

      // Review modal
      const open = prog(t, 30.55, 0.35, "power3.out");
      const close = prog(t, 35.85, 0.22, "power2.in");
      const mv = open * (1 - close);
      // visibility, not display: the camera measures the modal after it closes
      css(backdrop, "visibility", mv > 0 ? "visible" : "hidden");
      if (mv > 0) {
        op(backdrop, mv);
        css(modal, "transform", `translateY(${fx(10 * (1 - open))}px)`);
        const hover = t > 32.45 && t < 35.1;
        targetRow.classList.toggle("hover", hover && t < 32.85);
        const editing = t >= 32.85 && t < 35.05;
        const saved = t >= 35.05;
        targetRow.classList.toggle("commented", saved);
        show(cEdit, editing);
        show(cSaved, saved);
        const n = Math.floor(clamp((t - 33.05) / 1.45) * COMMENT.length);
        txt(cTyped, COMMENT.slice(0, n));
        show(cPh, n === 0);
        op(cCaret, Math.floor(t / 0.53) % 2 === 0 || (t > 33.05 && t < 34.5) ? 1 : 0);
        cSave.classList.toggle("press", t > 34.98 && t < 35.12);
        txt(rvMsg, `${saved ? 1 : 0} comment${saved ? "" : "s"} · click a line to comment`);
        cls(rvSend, "btn primary" + (saved ? "" : " dis") + (t > 35.62 && t < 35.8 ? " press" : ""));
      }

      // Toast
      const tv = span(t, 36.0, 37.7, 0.3, 0.35);
      show(toast, tv > 0);
      if (tv > 0) {
        op(toast, tv);
        css(toast, "transform", `translate(-50%, ${fx(6 * (1 - prog(t, 36.0, 0.3)))}px)`);
      }

      // Pointer: review clicks, drag-and-drop, ⌘-click
      let pt = null, pv = 0, click = 0;
      if (t > 31.3 && t < 36.1) {
        pv = span(t, 31.4, 36.0, 0.3, 0.25);
        pt = pathAt(t, [
          [0, 0, at(modal, 0.78, 0.86)],
          [31.65, 0.85, at(targetRow, 0.42, 0.55)],
          [34.55, 0.45, at(cSave, 0.5, 0.6)],
          [35.12, 0.5, at(rvSend, 0.5, 0.6)],
        ]);
        click = Math.max(dip(t, 32.75), dip(t, 34.98), dip(t, 35.62));
      } else if (t > 36.95 && t < 38.3) {
        const pr3 = finalRect(byIdx[DROP]);
        pv = span(t, 37.0, 38.25, 0.15, 0.2);
        pt = pathAt(t, [
          [0, 0, () => ({ x: pr3.x - 260, y: pr3.y + pr3.h * 0.82 })],
          [37.1, 0.8, () => ({ x: pr3.x + pr3.w * 0.46, y: pr3.y + pr3.h * 0.58 }), "power3.out"],
        ]);
        const gv = 1 - prog(t, 38.0, 0.16, "power2.in");
        show(ghost, gv > 0);
        op(ghost, gv * pv);
        css(ghost, "transform", `translate(${fx(pt.x + 10)}px, ${fx(pt.y + 14)}px) scale(${fx(0.85 + 0.15 * gv)})`);
      } else if (t > 38.7 && t < 40.4) {
        pv = span(t, 38.75, 40.35, 0.2, 0.25);
        pt = pathAt(t, [
          [0, 0, at(() => byIdx[LINK].linkEl, 1.0, 1.0, 150, 70)],
          [38.8, 0.55, at(() => byIdx[LINK].linkEl, 0.55, 0.7)],
        ]);
        click = dip(t, 39.5);
      }
      if (!(t > 36.95 && t < 38.3)) show(ghost, false);
      show(pointer, pv > 0 && pt);
      if (pv > 0 && pt) {
        op(pointer, pv);
        css(pointer, "transform", `translate(${fx(pt.x)}px, ${fx(pt.y)}px) scale(${fx(1 - 0.12 * click)})`);
      }

      // Camera (after layout so measurements are current)
      const c = cameraAt(t);
      css(cam, "transform", `translate(${fx(CX - c.s * c.fx)}px, ${fx(CY - c.s * c.fy)}px) scale(${fx(c.s)})`);
    }
    function dip(t, a) {
      return Math.sin(clamp((t - a) / 0.16) * Math.PI);
    }
    return render;
  }

  // ---------- timeline ----------
  const clock = {
    _t: 0,
    get t() {
      return this._t;
    },
    set t(v) {
      this._t = v;
      draw();
    },
  };
  const tl = gsap.timeline({ paused: true });
  tl.fromTo(clock, { t: 0 }, { t: DUR, duration: DUR, ease: "none" }, 0);
  window.__aureliaTimeline = tl; // registered on window.__timelines by the page
  // The compiler may hoist this script above the root, so build on first use.
  let render = null;
  function draw() {
    if (!render) {
      const root = document.querySelector("[data-composition-id]");
      if (!root) return;
      render = build(root);
    }
    render(clock._t);
  }
  draw();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", draw);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
})();
