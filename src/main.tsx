import { listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startCacheWatch } from "./lib/cache";
import { startDiscord } from "./lib/discord";
import { installFileDrop } from "./lib/filedrop";
import { setHome } from "./lib/format";
import { ipc } from "./lib/ipc";
import { applyPaletteVars } from "./lib/palettes";
import { primeNotifications } from "./lib/notify";
import { startHudBridge } from "./lib/hudBridge";
import { installShortcuts } from "./lib/shortcuts";
import { applyAppearance } from "./lib/terminals";
import { onSystemThemeChange, resolveDark } from "./lib/theme";
import { startVoice } from "./lib/voice";
import { trackAttention, useAgents, type AgentEvent } from "./store/agents";
import { trackNoticeFocus, useNotices } from "./store/notifications";
import { useConfig } from "./store/config";
import { startGitPolling } from "./store/git";
import { serializeLayout, useLayout, type SavedLayout } from "./store/layout";
import { loadRecents } from "./store/recents";
import { loadTasks } from "./store/tasks";
import { loadUiState, useUi } from "./store/ui";
import { startMetrics } from "./store/metrics";
import { startUsagePolling } from "./store/usage";
import "./styles.css";
import "./launcher.css";
import "./sidebar.css";
import "./settings.css";
import "./cache.css";
import "./voice.css";
import "./notices.css";
import "./forecast.css";
import "./metrics.css";

function applyTheme() {
  const cfg = useConfig.getState().config;
  const dark = resolveDark(cfg?.theme ?? "system");
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  applyPaletteVars(cfg?.palette, dark);
  applyAppearance();
}

function persistLayout() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => ipc.saveState("layout", serializeLayout()).catch(() => {});
  useLayout.subscribe((s, prev) => {
    if (s.tabs === prev.tabs && s.panes === prev.panes && s.activeTabId === prev.activeTabId) return;
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  });
  window.addEventListener("beforeunload", save);
}

async function boot() {
  await useConfig.getState().load();
  setHome(await homeDir().catch(() => ""));
  await Promise.all([loadUiState(), loadTasks(), loadRecents()]);
  const saved = await ipc.loadState<SavedLayout>("layout").catch(() => null);
  useLayout.getState().hydrate(saved);
  persistLayout();

  applyTheme();
  onSystemThemeChange(applyTheme);
  useConfig.subscribe((s, prev) => s.config !== prev.config && applyTheme());
  useUi.subscribe((s, prev) => s.fontDelta !== prev.fontDelta && applyAppearance());

  await listen<{ paneId: string; code: number | null }>("pty-exit", (e) => useLayout.getState().closePane(e.payload.paneId));
  await listen<AgentEvent>("agent-event", (e) => useAgents.getState().handle(e.payload));
  await listen("menu-settings", () => useUi.getState().set({ settingsOpen: true }));

  window.addEventListener("focus", () => useUi.getState().set({ windowFocused: true }));
  window.addEventListener("blur", () => useUi.getState().set({ windowFocused: false }));
  installShortcuts();
  await installFileDrop();
  startUsagePolling();
  startGitPolling();
  trackAttention();
  trackNoticeFocus();
  startCacheWatch();
  startMetrics();
  startVoice().catch(() => {});
  primeNotifications();
  startHudBridge().catch(() => {});
  startDiscord();
  checkFullDiskAccess();

  createRoot(document.getElementById("root")!).render(<App />);
  hideSplash();
}

/** Without Full Disk Access, commands run in the terminals trigger a macOS prompt per
 *  folder, and "access data from other apps" comes back every launch. */
async function checkFullDiskAccess() {
  if (await ipc.hasFullDiskAccess().catch(() => true)) return;
  useNotices.getState().push({
    kind: "info",
    key: "full-disk-access",
    sticky: true,
    title: "Give AureliaSpace Full Disk Access",
    body: "Stops the repeated macOS permission popups. Turn on AureliaSpace in the list, then reopen the app.",
    actions: [
      { label: "Open Settings", tone: "primary", run: () => void ipc.openFullDiskAccessSettings() },
      { label: "Not now", run: () => {} },
    ],
  });
}

/** Fades out the load-in splash from index.html once the first frame is up, after a minimum show time. */
function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  const start = (window as { __splashStart?: number }).__splashStart ?? 0;
  const wait = Math.max(0, 1600 - (performance.now() - start));
  setTimeout(() => {
    requestAnimationFrame(() => splash.classList.add("out"));
    setTimeout(() => splash.remove(), 700);
  }, wait);
}

boot().catch((e) => {
  document.getElementById("splash")?.remove();
  document.body.textContent = `AureliaSpace failed to start: ${e}`;
});
