import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useLayout } from "../store/layout";
import { insertAtPrompt } from "./terminals";

/** Backslash-escapes a path for zsh, the way Terminal.app and iTerm do on drop. */
export function shellEscape(path: string) {
  return path.replace(/[^A-Za-z0-9_\-.,:/@+=%~]/g, "\\$&");
}

let hovered: HTMLElement | null = null;

function setHovered(el: HTMLElement | null) {
  if (el === hovered) return;
  hovered?.classList.remove("drop-target");
  el?.classList.add("drop-target");
  hovered = el;
}

/** Tauri reports physical pixels; the DOM works in CSS pixels. */
function paneAt(position: { x: number; y: number }): HTMLElement | null {
  const ratio = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(position.x / ratio, position.y / ratio);
  return el?.closest<HTMLElement>("[data-pane-id]") ?? null;
}

/**
 * Tauri's native drag-drop handler swallows file drops before the webview sees them,
 * so files dropped on a pane are turned into escaped paths typed at its prompt.
 */
export async function installFileDrop() {
  await getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === "enter" || p.type === "over") {
      setHovered(paneAt(p.position));
    } else if (p.type === "leave") {
      setHovered(null);
    } else if (p.type === "drop") {
      setHovered(null);
      const paneId = paneAt(p.position)?.dataset.paneId;
      if (!paneId || p.paths.length === 0) return;
      useLayout.getState().focusPane(paneId);
      insertAtPrompt(paneId, p.paths.map(shellEscape).join(" ") + " ");
    }
  });
}
