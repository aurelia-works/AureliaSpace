/**
 * CodeMirror 6 setup for editor panes. Imported lazily (components/EditorPane.tsx) so the
 * terminal app never loads it until a file is opened. Colours come from the app's CSS
 * variables, so the editor follows every palette and light/dark without its own theme.
 */
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting, type LanguageSupport } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

async function languageFor(path: string): Promise<LanguageSupport | null> {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ typescript: ext.includes("t"), jsx: ext.endsWith("x") });
    }
    case "rs":
      return (await import("@codemirror/lang-rust")).rust();
    case "py":
      return (await import("@codemirror/lang-python")).python();
    case "json":
    case "jsonc":
      return (await import("@codemirror/lang-json")).json();
    case "md":
    case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "css":
    case "scss":
      return (await import("@codemirror/lang-css")).css();
    case "html":
    case "htm":
    case "svg":
    case "xml":
      return (await import("@codemirror/lang-html")).html();
    case "yml":
    case "yaml":
      return (await import("@codemirror/lang-yaml")).yaml();
    default:
      return null;
  }
}

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--pane-bg)", color: "var(--text)", fontSize: "13px" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--text)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--work) 28%, transparent) !important",
  },
  ".cm-gutters": { backgroundColor: "var(--pane-bg)", color: "var(--text-faint)", border: "none" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--text) 4%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-dim)" },
  ".cm-panels": { backgroundColor: "var(--surface)", color: "var(--text)", borderColor: "var(--border)" },
  ".cm-panels input, .cm-panels button": { fontSize: "12px" },
  ".cm-tooltip": { backgroundColor: "var(--surface)", border: "1px solid var(--border-strong)" },
  ".cm-matchingBracket": { outline: "1px solid var(--text-faint)", backgroundColor: "transparent" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--warn) 30%, transparent)" },
});

// Palette-neutral syntax colours: a few roles mapped to the app's status hues.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--work)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--ok)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--warn)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--text-faint)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--text)", fontWeight: "550" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--accent)" },
  { tag: [t.definition(t.variableName), t.propertyName], color: "var(--text)" },
  { tag: [t.heading], fontWeight: "700" },
  { tag: [t.link, t.url], textDecoration: "underline" },
  { tag: t.invalid, color: "var(--err)" },
]);

export interface EditorHandle {
  getText(): string;
  /** Replaces the whole document (a reload from disk); keeps the cursor near where it was. */
  setText(text: string): void;
  gotoLine(line: number, col?: number): void;
  focus(): void;
  destroy(): void;
}

export async function createEditor(
  parent: HTMLElement,
  opts: { path: string; text: string; onChange(): void; onSave(): void },
): Promise<EditorHandle> {
  const language = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.text,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab, { key: "Mod-s", preventDefault: true, run: () => (opts.onSave(), true) }]),
        theme,
        // Panes sit beside terminals and are often narrow; wrap rather than scroll sideways.
        EditorView.lineWrapping,
        syntaxHighlighting(highlight),
        language.of([]),
        EditorView.updateListener.of((u) => u.docChanged && opts.onChange()),
      ],
    }),
  });
  languageFor(opts.path).then((lang) => lang && view.dispatch({ effects: language.reconfigure(lang) }));

  return {
    getText: () => view.state.doc.toString(),
    setText(text) {
      const head = Math.min(view.state.selection.main.head, text.length);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: head } });
    },
    gotoLine(line, col = 1) {
      const doc = view.state.doc;
      const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
      const pos = Math.min(l.from + Math.max(0, col - 1), l.to);
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
