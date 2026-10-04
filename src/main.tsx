import { listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installFileDrop } from "./lib/filedrop";
import { setHome } from "./lib/format";
import { ipc } from "./lib/ipc";
import { primeNotifications } from "./lib/notify";
import { installShortcuts } from "./lib/shortcuts";
import { applyAppearance } from "./lib/terminals";
import { onSystemThemeChange, resolveDark } from "./lib/theme";
import { trackAttention, useAgents, type AgentEvent } from "./store/agents";
import { useConfig } from "./store/config";
import { startGitPolling } from "./store/git";
import { serializeLayout, useLayout, type SavedLayout } from "./store/layout";
import { loadTasks } from "./store/tasks";
import { loadUiState, useUi } from "./store/ui";
import { startUsagePolling } from "./store/usage";
import "./styles.css";

function applyTheme() {
  const cfg = useConfig.getState().config;
  const dark = resolveDark(cfg?.theme ?? "system");
  document.documentElement.dataset.theme = dark ? "dark" : "light";
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
  await Promise.all([loadUiState(), loadTasks()]);
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
  primeNotifications();

  createRoot(document.getElementById("root")!).render(<App />);
}

boot().catch((e) => {
  document.body.textContent = `AureliaSpace failed to start: ${e}`;
});
