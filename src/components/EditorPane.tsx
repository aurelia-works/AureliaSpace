import { useEffect, useRef, useState } from "react";
import type { EditorHandle } from "../lib/editor";
import { ipc } from "../lib/ipc";
import { useEditors } from "../lib/openFile";
import { paneIds, useLayout } from "../store/layout";
import { toast, useUi } from "../store/ui";

type Load = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

/**
 * A file in CodeMirror (lib/editor.ts, loaded on first use). ⌘S saves atomically; a save
 * over a file that changed on disk asks first, and an unchanged buffer follows the disk
 * while it's on screen (an agent edited it).
 */
export function EditorPane({ paneId }: { paneId: string }) {
  const editor = useLayout((s) => s.panes[paneId]?.editor);
  const path = editor?.path ?? "";
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<EditorHandle | null>(null);
  const mtime = useRef<number | null>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [conflict, setConflict] = useState(false);
  const jump = useEditors((s) => s.jump[paneId]);
  const windowFocused = useUi((s) => s.windowFocused);
  const visible = useLayout((s) => s.tabs.some((t) => t.id === s.activeTabId && paneIds(t.root).includes(paneId)));

  const save = async (force = false) => {
    const h = handle.current;
    if (!h) return;
    try {
      mtime.current = await ipc.writeTextFile(path, h.getText(), force ? null : mtime.current);
      useEditors.getState().setDirty(paneId, false);
      setConflict(false);
    } catch (e) {
      if (String(e).includes("CHANGED_ON_DISK")) setConflict(true);
      else toast(`Couldn't save: ${e}`, true);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  const reload = async () => {
    const f = await ipc.readTextFile(path).catch((e) => (toast(String(e), true), null));
    if (!f || !handle.current) return;
    handle.current.setText(f.text);
    mtime.current = f.mtimeMs;
    useEditors.getState().setDirty(paneId, false);
    setConflict(false);
  };

  // (Re)open when the pane's file changes.
  useEffect(() => {
    if (!path || !host.current) return;
    let cancelled = false;
    setLoad({ kind: "loading" });
    setConflict(false);
    (async () => {
      try {
        const [f, mod] = await Promise.all([ipc.readTextFile(path), import("../lib/editor")]);
        if (cancelled || !host.current) return;
        handle.current?.destroy();
        host.current.textContent = "";
        mtime.current = f.mtimeMs;
        handle.current = await mod.createEditor(host.current, {
          path,
          text: f.text,
          onChange: () => useEditors.getState().setDirty(paneId, true),
          onSave: () => void saveRef.current(),
        });
        useEditors.getState().setDirty(paneId, false);
        setLoad({ kind: "ready" });
        const at = useLayout.getState().panes[paneId]?.editor;
        if (at?.line) handle.current.gotoLine(at.line, at.col);
        handle.current.focus();
      } catch (e) {
        if (!cancelled) setLoad({ kind: "error", message: String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, paneId]);

  useEffect(() => () => handle.current?.destroy(), []);

  // A jump to a line in a file that is already open.
  useEffect(() => {
    if (jump && load.kind === "ready" && jump.path === path) {
      handle.current?.gotoLine(jump.line, jump.col);
      handle.current?.focus();
      useEditors.getState().takeJump(paneId);
    }
  }, [jump?.at, load.kind]);

  // Follow the disk while it's on screen: a clean buffer reloads when an agent edits the
  // file; one with unsaved changes shows the conflict bar before you try to save.
  useEffect(() => {
    if (!windowFocused || !visible || load.kind !== "ready") return;
    let busy = false;
    const check = async () => {
      if (busy || mtime.current === null) return;
      busy = true;
      try {
        const now = await ipc.fileMtime(path);
        if (Math.abs(now - mtime.current) <= 1) return;
        if (useEditors.getState().dirty[paneId]) return setConflict(true);
        const f = await ipc.readTextFile(path);
        if (useEditors.getState().dirty[paneId]) return setConflict(true);
        handle.current?.setText(f.text);
        mtime.current = f.mtimeMs;
        useEditors.getState().setDirty(paneId, false);
      } catch {
        // Deleted or unreadable: leave the buffer as it is; a save recreates the file.
      } finally {
        busy = false;
      }
    };
    check();
    const timer = setInterval(check, 2000);
    return () => clearInterval(timer);
  }, [windowFocused, visible, load.kind, path]);

  return (
    <div className="editor-pane">
      {conflict && (
        <div className="editor-bar warn">
          <span>Changed on disk since you opened it.</span>
          <button onClick={reload}>Reload from disk</button>
          <button onClick={() => save(true)}>Overwrite with mine</button>
        </div>
      )}
      {load.kind === "error" && <p className="empty">{load.message}</p>}
      {load.kind === "loading" && <p className="empty">Opening…</p>}
      <div className="editor-host" ref={host} />
    </div>
  );
}
