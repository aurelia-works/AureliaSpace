import { useEffect, useRef, useState } from "react";
import { ipc } from "../lib/ipc";
import { focusTerminal, getEntry, insertAtPrompt } from "../lib/terminals";
import { useConfig } from "../store/config";
import { useLayout } from "../store/layout";
import { useUi } from "../store/ui";
import { SparkIcon } from "./Icons";

type State =
  | { kind: "input" }
  | { kind: "loading" }
  | { kind: "result"; command: string }
  | { kind: "error"; message: string };

const providerName = { ollama: "Ollama (local)", gemini: "Gemini", openrouter: "OpenRouter" } as const;

/**
 * ⌘I: natural language → one proposed shell command. The command is only ever shown
 * or inserted at the prompt; it is never executed.
 */
export function SuggestBar({ paneId }: { paneId: string }) {
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<State>({ kind: "input" });
  const [includeOutput, setIncludeOutput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const provider = useConfig((s) => s.config?.suggestions.provider ?? "ollama");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (state.kind === "result") resultRef.current?.focus();
    if (state.kind === "input" || state.kind === "error") inputRef.current?.focus();
  }, [state.kind]);

  const close = () => {
    useUi.getState().set({ suggestPaneId: null });
    focusTerminal(paneId);
  };

  const submit = async () => {
    if (!prompt.trim()) return;
    const entry = getEntry(paneId);
    const tracker = entry?.tracker;
    const last = includeOutput ? tracker?.lastFinished() : undefined;
    setState({ kind: "loading" });
    try {
      const command = await ipc.suggestCommand({
        prompt,
        cwd: useLayout.getState().panes[paneId]?.cwd,
        recentCommands: tracker?.recentCommands(5) ?? [],
        lastOutput: last && tracker ? tracker.outputText(last).slice(-4000) : undefined,
      });
      setState({ kind: "result", command });
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  };

  const insert = (command: string) => {
    insertAtPrompt(paneId, command);
    useUi.getState().set({ suggestPaneId: null });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" && state.kind === "result") {
      e.preventDefault();
      insert(state.command);
    } else if (e.key === "Enter" && (state.kind === "input" || state.kind === "error")) {
      e.preventDefault();
      submit();
    } else if (state.kind === "result" && (e.key === "Tab" || e.key.length === 1) && !e.metaKey) {
      // Typing again goes back to editing the request.
      setState({ kind: "input" });
    }
  };

  return (
    <div className="suggest-bar" onKeyDown={onKey}>
      <div className="suggest-row">
        <SparkIcon className="suggest-icon" />
        <input
          ref={inputRef}
          value={prompt}
          placeholder="Describe a command… e.g. “find files over 100MB here”"
          onChange={(e) => {
            setPrompt(e.target.value);
            if (state.kind !== "input" && state.kind !== "loading") setState({ kind: "input" });
          }}
          disabled={state.kind === "loading"}
          spellCheck={false}
        />
        <label className="suggest-opt" title="Also send the last command's output to the model">
          <input type="checkbox" checked={includeOutput} onChange={(e) => setIncludeOutput(e.target.checked)} />
          last output
        </label>
      </div>
      {state.kind === "loading" && <div className="suggest-status">Asking {providerName[provider]}…</div>}
      {state.kind === "error" && <div className="suggest-status error">{state.message}</div>}
      {state.kind === "result" && (
        <div className="suggest-result" ref={resultRef} tabIndex={0}>
          <code>{state.command}</code>
          <div className="suggest-actions">
            <button className="primary" onClick={() => insert(state.command)}>
              Insert <kbd>↵</kbd>
            </button>
            <button onClick={() => navigator.clipboard.writeText(state.command).catch(() => {})}>Copy</button>
          </div>
        </div>
      )}
      <div className="suggest-foot">
        {providerName[provider]} · sends cwd, shell and recent commands{includeOutput ? " + last output" : ""} · never runs anything · Esc to close
      </div>
    </div>
  );
}
