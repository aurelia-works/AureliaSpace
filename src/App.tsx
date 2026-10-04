import { useEffect } from "react";
import { AccountPicker } from "./components/AccountPicker";
import { AgentPanel } from "./components/AgentPanel";
import { DiffReview } from "./components/DiffReview";
import { FilesPanel } from "./components/FilesPanel";
import { GridPicker } from "./components/GridPicker";
import { LayoutView } from "./components/LayoutView";
import { SettingsModal } from "./components/SettingsModal";
import { TabBar } from "./components/TabBar";
import { Toast } from "./components/Toast";
import { focusTerminal } from "./lib/terminals";
import { activeTab, useLayout } from "./store/layout";
import { useUi } from "./store/ui";

export function App() {
  const tabs = useLayout((s) => s.tabs);
  const activeTabId = useLayout((s) => s.activeTabId);
  const agentPanelOpen = useUi((s) => s.agentPanelOpen);
  const filesOpen = useUi((s) => s.filesOpen);
  const focusKey = useLayout((s) => `${s.activeTabId}:${s.tabs.find((t) => t.id === s.activeTabId)?.focusedPaneId}`);
  const modalOpen = useUi((s) => s.settingsOpen || !!s.accountPicker || s.gridOpen || s.reviewOpen);

  // Keyboard focus follows the focused pane.
  useEffect(() => {
    if (modalOpen) return;
    const id = requestAnimationFrame(() => {
      const pane = activeTab()?.focusedPaneId;
      if (pane && useUi.getState().suggestPaneId !== pane) focusTerminal(pane);
    });
    return () => cancelAnimationFrame(id);
  }, [focusKey, modalOpen]);

  return (
    <div className="app">
      <TabBar />
      <div className="workspace">
        {filesOpen && <FilesPanel />}
        <main className="tabs-area">
          {tabs.map((tab) => (
            <div key={tab.id} className={`tab-content${tab.id === activeTabId ? "" : " hidden"}`}>
              <LayoutView node={tab.root} />
            </div>
          ))}
        </main>
        {agentPanelOpen && <AgentPanel />}
      </div>
      <AccountPicker />
      <GridPicker />
      <DiffReview />
      <SettingsModal />
      <Toast />
    </div>
  );
}
