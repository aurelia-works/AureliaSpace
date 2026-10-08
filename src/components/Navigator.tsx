import { useLayout } from "../store/layout";
import { useUi, type NavView } from "../store/ui";
import { FilesPanel } from "./FilesPanel";
import { CloseIcon, PlusIcon } from "./Icons";
import { ProjectsSidebar } from "./ProjectsSidebar";

/** Left column with two views: the workspace (panes by project, ⌘\) and the focused project's files (⇧⌘F). */
export function Navigator({ view }: { view: Exclude<NavView, null> }) {
  const set = useUi.getState().set;
  return (
    <aside className="navigator" aria-label="Navigator">
      <div className="nav-head">
        <div className="seg" role="tablist" aria-label="Navigator view">
          <button role="tab" aria-selected={view === "projects"} className={view === "projects" ? "on" : ""} onClick={() => set({ nav: "projects" })} title="Workspace (⌘\)">
            Workspace
          </button>
          <button role="tab" aria-selected={view === "files"} className={view === "files" ? "on" : ""} onClick={() => set({ nav: "files" })} title="Files (⇧⌘F)">
            Files
          </button>
        </div>
        {view === "projects" && (
          <button className="icon-btn sm" title="New shell tab in the default workspace" aria-label="New shell tab" onClick={() => useLayout.getState().newTab()}>
            <PlusIcon />
          </button>
        )}
        <button className="icon-btn sm nav-close" title="Hide navigator" aria-label="Hide navigator" onClick={() => set({ nav: null })}>
          <CloseIcon width={11} height={11} />
        </button>
      </div>
      <div className="nav-body">{view === "projects" ? <ProjectsSidebar /> : <FilesPanel />}</div>
    </aside>
  );
}
