import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { HudAction, HudRow, HudSnapshot, HudUsage } from "../hud/types";
import { alertUser } from "../store/notifications";
import { label, useAgents, type AgentSession } from "../store/agents";
import { useConfig } from "../store/config";
import { useLayout } from "../store/layout";
import { useMetrics } from "../store/metrics";
import { useUi } from "../store/ui";
import { forecastText } from "../components/UsageMeter";
import { useUsage } from "../store/usage";
import { answerPermission, permissionOptions } from "./permissions";
import { basename } from "./format";
import { resolveDark } from "./theme";
import { showPane } from "./terminals";

/** Needs input first, then finished and unseen, then working, then idle. */
function urgency(s: AgentSession) {
  return s.status === "needs_input" ? 0 : s.attention ? 1 : s.status === "working" ? 2 : 3;
}

function statusText(s: AgentSession) {
  if (s.status === "needs_input") return s.message || "needs input";
  if (s.status === "working") return s.tool ? `running ${s.tool}` : "working";
  if (s.attention) return "finished";
  return s.status === "starting" ? "starting" : "idle";
}

function snapshot(): HudSnapshot {
  const cfg = useConfig.getState().config;
  const metrics = useMetrics.getState().byPane;
  const sessions = Object.values(useAgents.getState().sessions).sort((a, b) => urgency(a) - urgency(b) || a.updatedAt - b.updatedAt);
  const rows: HudRow[] = sessions.map((s) => {
    const m = metrics[s.paneId];
    return {
      paneId: s.paneId,
      status: s.status,
      attention: !!s.attention,
      account: s.account ?? "claude",
      folder: s.cwd ? basename(s.cwd) : label(s),
      text: statusText(s),
      contextPct: m?.contextPct,
      costUsd: m?.costUsd,
      hot: m?.hot,
      perm: s.status === "needs_input" ? permissionOptions(s.paneId) : null,
    };
  });
  const { usage, forecasts } = useUsage.getState();
  const accounts = [...new Set(Object.values(useLayout.getState().panes).map((p) => p.account).filter((a): a is string => !!a))];
  const hudUsage: HudUsage[] = accounts.flatMap((account) => {
    const u = usage[account];
    if (!u) return [];
    const f = forecasts[account];
    return [{ account, fiveHour: u.fiveHour, sevenDay: u.sevenDay, fiveEta: forecastText(f?.["5h"]), sevenEta: forecastText(f?.["7d"]) }];
  });
  return { dark: resolveDark(cfg?.theme ?? "system"), palette: cfg?.palette ?? "aurelia", rows, usage: hudUsage };
}

let shown = false;
let last = "";

function shouldShow() {
  return useConfig.getState().config?.hud?.enabled === true && !useUi.getState().windowFocused;
}

async function send(force = false) {
  if (!shown) return;
  const snap = snapshot();
  if (!snap.rows.length) {
    shown = false;
    last = "";
    await invoke("hud_hide").catch(() => {});
    return;
  }
  const json = JSON.stringify(snap);
  if (!force && json === last) return;
  last = json;
  await emitTo("hud", "hud-state", snap).catch(() => {});
}

/** Show only while enabled, AureliaSpace isn't focused and there's something to list. */
async function sync() {
  const want = shouldShow() && Object.keys(useAgents.getState().sessions).length > 0;
  if (want && !shown) {
    shown = true;
    last = "";
    await invoke("hud_show").catch(() => (shown = false));
    void send(true);
  } else if (!want && shown) {
    shown = false;
    last = "";
    await invoke("hud_hide").catch(() => {});
  } else void send();
}

export function toggleHud() {
  const cfg = useConfig.getState().config;
  if (!cfg) return;
  const enabled = !(cfg.hud?.enabled ?? false);
  void useConfig.getState().save({ ...cfg, hud: { ...cfg.hud, enabled } });
  alertUser({
    kind: "info",
    key: "hud-toggle",
    desktop: false,
    title: enabled ? "HUD on" : "HUD off",
    body: enabled ? "It appears while you're in other apps." : undefined,
  });
}

/** Feeds the floating HUD window and handles what it asks for. Main window only. */
export async function startHudBridge() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void sync();
    }, 250);
  };
  useAgents.subscribe(soon);
  useMetrics.subscribe(soon);
  useUsage.subscribe(soon);
  useConfig.subscribe(soon);
  useUi.subscribe((s, prev) => s.windowFocused !== prev.windowFocused && soon());
  // Permission prompts appear in terminal output, which no store tracks.
  setInterval(() => shown && void send(), 1000);

  await listen("hud-ready", () => void send(true));
  await listen<HudAction>("hud-action", (e) => {
    const a = e.payload;
    if (a.type === "open") {
      void invoke("focus_main");
      showPane(a.paneId);
    } else {
      answerPermission(a.paneId, a.choice);
      setTimeout(() => void send(), 300);
    }
  });
  void sync();
}
