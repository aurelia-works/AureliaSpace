import { useUi, type NavView } from "../store/ui";
import { FilesPanel } from "./FilesPanel";
import { CloseIcon } from "./Icons";
import { ProblemsPanel } from "./ProblemsPanel";
import { ProjectsSidebar } from "./ProjectsSidebar";
import { SearchPanel } from "./SearchPanel";
import { ThreadPanel } from "./ThreadPanel";

type View = Exclude<NavView, null>;

const PROJECT_VIEWS: { view: View; label: string; keys: string }[] = [
  { view: "files", label: "Tree", keys: "⇧⌘F" },
  { view: "search", label: "Search", keys: "⌥⌘F" },
  { view: "problems", label: "Problems", keys: "⇧⌘M" },
];

/**
 * Left column: the workspace (panes by project, ⌘\), the focused project (its files,
 * search and type errors), and the focused Claude pane's conversation as a thread.
 */
export function Navigator({ view }: { view: View }) {
  const set = useUi.getState().set;
  const inProject = view === "files" || view === "search" || view === "problems";
  const top = (v: View, label: string, title: string, on: boolean) => (
    <button role="tab" aria-selected={on} className={on ? "on" : ""} onClick={() => set({ nav: v })} title={title}>
      {label}
    </button>
  );
  // The threads list has its own top (New thread, filter) and footer (Project, Log, Settings).
  if (view === "projects")
    return (
      <aside className="navigator" aria-label="Threads">
        <div className="nav-body">
          <ProjectsSidebar />
        </div>
      </aside>
    );
  return (
    <aside className={`navigator${view === "thread" ? " wide" : ""}`} aria-label="Navigator">
      <div className="nav-head">
        <div className="seg" role="tablist" aria-label="Navigator view">
          {top("projects", "Threads", "Threads by project (⌘\\)", false)}
          {top("files", "Project", "Files, search and problems (⇧⌘F)", inProject)}
          {top("thread", "Log", "The focused Claude pane's conversation (⌥⌘T)", view === "thread")}
        </div>
        <button className="icon-btn sm nav-close" title="Hide navigator" aria-label="Hide navigator" onClick={() => set({ nav: null })}>
          <CloseIcon width={11} height={11} />
        </button>
      </div>
      {inProject && (
        <div className="nav-subtabs" role="tablist" aria-label="Project view">
          {PROJECT_VIEWS.map((p) => (
            <button key={p.view} role="tab" aria-selected={view === p.view} className={view === p.view ? "on" : ""} title={`${p.label} (${p.keys})`} onClick={() => set({ nav: p.view })}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className="nav-body">
        {view === "search" ? (
          <SearchPanel />
        ) : view === "problems" ? (
          <ProblemsPanel />
        ) : view === "thread" ? (
          <ThreadPanel />
        ) : (
          <FilesPanel />
        )}
      </div>
    </aside>
  );
}
