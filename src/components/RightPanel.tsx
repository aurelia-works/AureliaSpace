import { useUi, type RailTab } from "../store/ui";
import { ChangesPanel } from "./ChangesPanel";
import { DetailsPanel } from "./DetailsPanel";
import { QueueRail } from "./QueueRail";

const TABS: { tab: RailTab; label: string; title: string }[] = [
  { tab: "queue", label: "Queue", title: "Threads that need you, tasks and saved prompts" },
  { tab: "changes", label: "Changes", title: "The focused thread's changes: this turn, its branch, or uncommitted" },
  { tab: "details", label: "Details", title: "The focused thread's folder, branch, PR and usage" },
];

/** Right column beside the threads: the queue, or the focused thread's changes and details. */
export function RightPanel() {
  const tab = useUi((s) => s.railTab);
  return (
    <aside className={`rail rail-${tab}`} aria-label="Side panel">
      <div className="rail-tabs" role="tablist" aria-label="Side panel">
        {TABS.map((t) => (
          <button key={t.tab} role="tab" aria-selected={tab === t.tab} className={tab === t.tab ? "on" : ""} title={t.title} onClick={() => useUi.getState().set({ railTab: t.tab })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "queue" ? <QueueRail /> : tab === "changes" ? <ChangesPanel /> : <DetailsPanel />}
    </aside>
  );
}
