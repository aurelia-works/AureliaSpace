/**
 * Preview harness for design screenshots: boots the real app (src/main.tsx) against a
 * scripted Tauri IPC, then drives agent state through the real stores (useAgents.handle,
 * the same path hook events take). Nothing here ships; `npm run build` never sees it.
 *
 *   /design/preview/?theme=dark&view=board|terminals|review|settings|start|palette
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const params = new URLSearchParams(location.search);
const theme = (params.get("theme") ?? "dark") as "dark" | "light";
const view = params.get("view") ?? "terminals";
const HOME = "/Users/you";
const dev = (p: string) => `${HOME}/dev/${p}`;

const enc = (s: string) => btoa(unescape(encodeURIComponent(s)));
const ESC = "\x1b";
const osc = (s: string) => `${ESC}]${s}\x07`;
const dim = (s: string) => `${ESC}[2m${s}${ESC}[0m`;
const bold = (s: string) => `${ESC}[1m${s}${ESC}[0m`;
const col = (n: number, s: string) => `${ESC}[${n}m${s}${ESC}[0m`;
const prompt = (cwd: string) => `${osc(`6973;cwd;${enc(cwd)}`)}${osc("133;A")}${col(36, cwd.replace(HOME, "~"))} ${col(33, "❯")} `;
const run = (cmd: string) => `${cmd}${osc(`6973;cmd;${enc(cmd)}`)}${osc("133;C")}\r\n`;
const done = (code: number) => osc(`133;D;${code}`);

function claudeScreen(cwd: string, body: string[]): string {
  return [prompt(cwd) + run("claude"), `${col(33, "✻")} Welcome to ${bold("Claude Code")}  ${dim(cwd.replace(HOME, "~"))}`, "", ...body].join("\r\n");
}

const SCREENS: Record<string, string> = {
  p1: claudeScreen(dev("api-server"), [
    `${col(90, ">")} run the pending migrations and fix the failing user test`,
    "",
    `${col(32, "⏺")} I'll check the migration status first.`,
    "",
    `${col(32, "⏺")} ${bold("Bash")}(npm run migrate:status)`,
    `  ⎿  3 pending: 0042_add_org_id, 0043_backfill, 0044_index`,
    "",
    col(38, "────────────────────────────────────────────────────"),
    ` ${bold("Bash command")}`,
    `   npm run migrate -- --to 0044`,
    `   ${dim("Apply 3 pending migrations")}`,
    ``,
    ` Do you want to proceed?`,
    ` ${col(36, "❯")} 1. Yes`,
    `   2. Yes, and don't ask again for npm run commands`,
    `   3. No, and tell Claude what to do differently (esc)`,
  ]),
  p2: claudeScreen(dev("web"), [
    `${col(90, ">")} make the settings page keyboard accessible`,
    "",
    `${col(32, "⏺")} ${bold("Read")}(src/settings/SettingsPage.tsx)`,
    `  ⎿  Read 214 lines`,
    `${col(32, "⏺")} ${bold("Edit")}(src/settings/SettingsPage.tsx)`,
    `  ⎿  Updated with 18 additions and 4 removals`,
    "",
    `${col(33, "✻")} Wiring roving tabindex… ${dim("(42s · ↓ 3.1k tokens · esc to interrupt)")}`,
  ]),
  p3: claudeScreen(dev("docs"), [
    `${col(90, ">")} rewrite the quickstart for the new CLI flags`,
    "",
    `${col(32, "⏺")} Updated docs/quickstart.md and docs/cli.md:`,
    `  • replaced --config with --profile in every example`,
    `  • added a "Multiple accounts" section`,
    `  • fixed 3 broken links`,
    "",
    `${col(32, "⏺")} Done. Want me to open a PR?`,
  ]),
  p4: claudeScreen(dev("payments"), [
    `${col(90, ">")} add idempotency keys to the refund endpoint`,
    "",
    `${col(32, "⏺")} ${bold("Bash")}(go test ./refunds/...)`,
    `  ⎿  ok  payments/refunds  4.211s`,
    `${col(32, "⏺")} ${bold("Bash")}(go test ./... -run Idempotency)`,
    "",
    `${col(33, "✻")} Running tests… ${dim("(1m 12s · esc to interrupt)")}`,
  ]),
  p5: claudeScreen(dev("infra"), [
    `${col(90, ">")} create the artifacts bucket with terraform`,
    "",
    `${col(32, "⏺")} The module needs a region. us-east-1 has the existing`,
    `  CDN origin, eu-west-1 keeps data in the EU for the Berlin team.`,
    "",
    `${col(32, "⏺")} Which region should the bucket live in?`,
  ]),
  p6: [
    prompt(dev("api-server")) + run("codex --oss"),
    `${bold("OpenAI Codex")} ${dim("(research preview) v0.42")}`,
    `${dim("model: gpt-oss:20b · provider: ollama")}`,
    "",
    `${col(35, "codex")} Reading src/routes/users.ts`,
    `${col(35, "codex")} The 500 comes from an unhandled null org_id.`,
    `${col(35, "codex")} Proposed patch: guard + 404 in getUserOrg()`,
    `${col(90, "▌")} apply patch? (y/n)`,
  ].join("\r\n"),
  p7: [
    prompt(dev("web")) + run("git status --short"),
    ` M src/settings/SettingsPage.tsx`,
    ` M src/settings/sections.css`,
    `?? src/settings/useRovingFocus.ts`,
    done(0) + "\r\n" + prompt(dev("web")) + run("npm test -- settings"),
    ``,
    ` ${col(32, "✓")} renders every section (41 ms)`,
    ` ${col(31, "✗")} moves focus with arrow keys (12 ms)`,
    ``,
    `   Expected: "appearance"`,
    `   Received: "general"`,
    ``,
    ` Tests: ${col(31, "1 failed")}, ${col(32, "1 passed")}, 2 total`,
    done(1) + "\r\n" + prompt(dev("web")) + run("npm run dev"),
    `  ${col(32, "VITE")} v8.3.2  ready in 212 ms`,
    `  ➜  Local:   ${col(36, "http://localhost:5173/")}`,
  ].join("\r\n"),
  p8: claudeScreen(dev("web"), [`${col(90, ">")} ${dim("Try \"refactor the router\"")}`]),
};

const PANES: Record<string, { cwd: string; account?: string; agent?: string; launcher?: boolean }> = {
  p1: { cwd: dev("api-server"), account: "claude" },
  p2: { cwd: dev("web"), account: "claude-b" },
  p3: { cwd: dev("docs"), account: "work" },
  p4: { cwd: dev("payments"), account: "claude" },
  p5: { cwd: dev("infra"), account: "claude-b" },
  p6: { cwd: dev("api-server"), agent: "codex:oss" },
  p7: { cwd: dev("web") },
  p8: { cwd: dev("web"), account: "work" },
  p9: { cwd: dev("api-server"), launcher: true },
};

const leaf = (id: string) => ({ type: "pane", id });
let sid = 0;
const split = (dir: "row" | "column", ratio: number, a: unknown, b: unknown) => ({ type: "split", id: `s${sid++}`, dir, ratio, a, b });
const row3 = (a: string, b: string, c: string) => split("row", 1 / 3, leaf(a), split("row", 0.5, leaf(b), leaf(c)));
const layout = {
  version: 1,
  activeTabId: view === "start" ? "t3" : "t1",
  tabs: [
    { id: "t1", root: split("column", 0.5, row3("p1", "p2", "p3"), row3("p4", "p5", "p6")), focusedPaneId: "p2" },
    { id: "t2", root: split("row", 0.55, leaf("p7"), leaf("p8")), focusedPaneId: "p7" },
    { id: "t3", root: leaf("p9"), focusedPaneId: "p9" },
  ],
  panes: Object.fromEntries(Object.entries(PANES).map(([id, p]) => [id, { id, ...p }])),
};

const config = {
  accounts: [
    { name: "claude", configDir: "~/.claude" },
    { name: "claude-b", configDir: "~/.claude-b" },
    { name: "work", configDir: "~/.claude-work" },
  ],
  usageScript: "",
  usageRefreshSeconds: 120,
  theme,
  palette: params.get("palette") ?? "aurelia",
  notifications: true,
  hud: { enabled: false },
  discord: { enabled: false, clientId: "", hideProject: false },
  defaultAccount: "claude",
  workspaceAccounts: {},
  editor: "",
  defaultWorkspace: "~/dev",
  terminal: { fontFamily: '"SF Mono", Menlo, monospace', fontSize: 12, lineHeight: 1.2, scrollback: 5000, optionAsMeta: true, webglPaneLimit: 0, shell: "/bin/zsh" },
  suggestions: {
    provider: "ollama",
    ollama: { baseUrl: "http://localhost:11434", model: "qwen2.5-coder:1.5b" },
    gemini: { baseUrl: "", model: "gemini-2.0-flash" },
    openrouter: { baseUrl: "", model: "" },
  },
  cache: { ttlMinutes: 60 },
  voice: { shellCleanup: false },
};

const inAnHour = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const USAGE: Record<string, unknown> = {
  claude: { fiveHour: 62, sevenDay: 41, fiveHourResetsAt: inAnHour(2.2), sevenDayResetsAt: inAnHour(80), updatedAt: Date.now() },
  "claude-b": { fiveHour: 91, sevenDay: 73, fiveHourResetsAt: inAnHour(0.7), sevenDayResetsAt: inAnHour(30), updatedAt: Date.now() },
  work: { fiveHour: 14, sevenDay: 22, fiveHourResetsAt: inAnHour(4), sevenDayResetsAt: inAnHour(120), updatedAt: Date.now() },
};

const BRANCH: Record<string, string> = {
  "api-server": "fix/user-org-null",
  web: "feat/settings-a11y",
  docs: "main",
  payments: "aurelia/refund-idempotency",
  infra: "infra/artifacts-bucket",
};

const DIFF = `diff --git a/src/settings/SettingsPage.tsx b/src/settings/SettingsPage.tsx
index 3b1c2a1..9f0e7d2 100644
--- a/src/settings/SettingsPage.tsx
+++ b/src/settings/SettingsPage.tsx
@@ -12,9 +12,14 @@ export function SettingsPage() {
   const [section, setSection] = useState(SECTIONS[0].id);
-  const onKey = (e: KeyboardEvent) => {
-    if (e.key === "Escape") close();
-  };
+  const nav = useRovingFocus(SECTIONS.length);
+  const onKey = (e: KeyboardEvent) => {
+    if (e.key === "Escape") return close();
+    nav.onKeyDown(e);
+  };

   return (
-    <nav className="settings-nav">
+    <nav className="settings-nav" role="tablist" aria-orientation="vertical">
       {SECTIONS.map((s, i) => (
-        <button key={s.id} onClick={() => setSection(s.id)}>
+        <button key={s.id} role="tab" tabIndex={nav.index === i ? 0 : -1} onClick={() => setSection(s.id)}>
diff --git a/src/settings/useRovingFocus.ts b/src/settings/useRovingFocus.ts
new file mode 100644
--- /dev/null
+++ b/src/settings/useRovingFocus.ts
@@ -0,0 +1,9 @@
+import { useState } from "react";
+
+export function useRovingFocus(count: number) {
+  const [index, setIndex] = useState(0);
+  const onKeyDown = (e: KeyboardEvent) => {
+    if (e.key === "ArrowDown") setIndex((i) => (i + 1) % count);
+    if (e.key === "ArrowUp") setIndex((i) => (i - 1 + count) % count);
+  };
+  return { index, onKeyDown };
+}
diff --git a/src/settings/sections.css b/src/settings/sections.css
index 1111111..2222222 100644
--- a/src/settings/sections.css
+++ b/src/settings/sections.css
@@ -3,4 +3,7 @@
 .settings-nav button {
   padding: 6px 10px;
 }
+.settings-nav button:focus-visible {
+  outline: 2px solid currentColor;
+}
`;

type Channel = { id: number };
let channelIndex = new Map<number, number>();
function feed(ch: Channel, text: string) {
  const index = channelIndex.get(ch.id) ?? 0;
  channelIndex.set(ch.id, index + 1);
  const bytes = new TextEncoder().encode(text);
  (window as any).__TAURI_INTERNALS__.runCallback(ch.id, { index, message: bytes.buffer });
}

mockWindows("main");
mockIPC(
  (cmd, args: any) => {
    switch (cmd) {
      case "get_config":
        return structuredClone(config);
      case "save_config":
        Object.assign(config, args.config);
        return null;
      case "load_state":
        if (args.name === "layout") return structuredClone(layout);
        if (args.name === "ui") return { mode: view === "board" ? "agents" : "terminals", agentPanelOpen: true, nav: "projects" };
        if (args.name === "tasks")
          return {
            projects: {
              [dev("web")]: [
                { id: "k1", title: "Keyboard-accessible settings nav", status: "doing", paneId: "p2", createdAt: 1 },
                { id: "k2", title: "Fix flaky focus test", status: "todo", createdAt: 2 },
                { id: "k3", title: "Dark mode contrast pass", status: "todo", createdAt: 3 },
                { id: "k4", title: "Bump vite", status: "done", createdAt: 4 },
              ],
            },
          };
        if (args.name === "recents") return { folders: [dev("web"), dev("api-server"), dev("payments"), dev("infra"), dev("docs")] };
        return null;
      case "pty_spawn":
        setTimeout(() => feed(args.onData, SCREENS[args.paneId] ?? prompt(args.cwd ?? HOME)), 60);
        return null;
      case "git_info": {
        const name = String(args.cwd).split("/").pop()!;
        return BRANCH[name] ? { root: args.cwd, branch: BRANCH[name], detached: false, worktree: name === "payments" } : null;
      }
      case "fetch_usage":
        return USAGE[args.account] ?? null;
      case "project_root":
        return args.cwd;
      case "git_diff":
        return { root: dev("web"), diff: DIFF, truncated: false };
      case "list_dir":
        return ["src", "public", "package.json", "tsconfig.json", "vite.config.ts", "README.md", ".gitignore"].map((n) => ({
          name: n,
          path: `${args.path}/${n}`,
          dir: !n.includes("."),
        }));
      case "has_full_disk_access":
      case "which":
      case "voice_installed":
        return true;
      case "agent_keys_present":
        return [];
      case "has_api_key":
        return false;
      case "transcript_usage":
        return { entries: [], offset: 0 };
      case "plugin:path|resolve_directory":
        return HOME;
      case "plugin:notification|is_permission_granted":
        return true;
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

// Settle: boot, let PTYs paint, then play hook events through the real agent store.
await import("../../src/main.tsx");
const { useAgents } = await import("../../src/store/agents.ts");
const { useMetrics } = await import("../../src/store/metrics.ts");
const { useUi } = await import("../../src/store/ui.ts");
const { useLayout } = await import("../../src/store/layout.ts");
const { useNotices } = await import("../../src/store/notifications.ts");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
await sleep(400);
useUi.setState({ windowFocused: true });
const ev = (pane: string, event: string, payload: Record<string, unknown> = {}) =>
  useAgents.getState().handle({ pane, event, configDir: "", ts: Date.now(), payload: { session_id: `s-${pane}`, cwd: PANES[pane].cwd, ...payload } });

const minutesAgo = (m: number) => Date.now() - m * 60_000;
for (const p of ["p1", "p2", "p3", "p4", "p5", "p8"]) ev(p, "SessionStart");
ev("p1", "UserPromptSubmit");
ev("p1", "Notification", { notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" });
ev("p2", "UserPromptSubmit");
ev("p2", "PreToolUse", { tool_name: "Edit" });
ev("p3", "UserPromptSubmit");
ev("p3", "Stop");
ev("p4", "UserPromptSubmit");
ev("p4", "PreToolUse", { tool_name: "Bash" });
ev("p5", "UserPromptSubmit");
ev("p5", "Notification", { notification_type: "elicitation", message: "Which region should the bucket live in?" });

// Spread the timestamps out so ages and the cache timer read like a real afternoon.
const ages: Record<string, [number, number]> = { p1: [3, 3], p2: [1, 0.5], p3: [7, 8], p4: [2, 0.2], p5: [5, 6], p8: [24, 52] };
useAgents.setState((s) => ({
  sessions: Object.fromEntries(
    Object.entries(s.sessions).map(([id, x]) => [id, { ...x, updatedAt: minutesAgo(ages[id]?.[0] ?? 1), lastRequestAt: minutesAgo(ages[id]?.[1] ?? 1) }]),
  ),
}));
const m = (contextPct: number, totalTokens: number, costUsd: number, hot = false) => ({
  contextTokens: contextPct * 2000, contextPct, totalTokens, costUsd, tokensPerMin: hot ? 180_000 : 20_000, hot, updatedAt: Date.now(),
});
useMetrics.setState({
  byPane: { p1: m(38, 412_000, 1.84), p2: m(57, 903_000, 3.12), p3: m(22, 188_000, 0.71), p4: m(88, 2_410_000, 7.9, true), p5: m(31, 260_000, 0.95), p8: m(9, 41_000, 0.12) },
});

if (view === "board") useUi.setState({ mode: "agents" });
if (view === "review") useUi.setState({ reviewOpen: true });
if (view === "settings") useUi.setState({ settingsOpen: true });
if (view === "palette") useUi.setState({ paletteOpen: true });
if (view === "files") useUi.setState({ nav: "files" });
if (view === "start") useLayout.getState().activateTab("t3");
if (view !== "terminals" && view !== "files") useNotices.getState().clear();
(window as any).__ready = true;
