import { Marked } from "marked";

/**
 * Claude's replies as HTML for chat panes. Raw HTML in the text is shown as text, never
 * run: the output goes into the page with innerHTML.
 */
const md = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    // Code blocks get a copy button (ChatPane handles the click).
    code({ text, lang }) {
      const cls = lang ? ` class="language-${escapeHtml(lang.split(/\s/)[0])}"` : "";
      return `<div class="chat-code"><button type="button" class="chat-copy" aria-label="Copy code">Copy</button><pre><code${cls}>${escapeHtml(text)}</code></pre></div>`;
    },
    // No remote loads from chat text: an image is a link to it.
    image({ href, text }) {
      return `<a href="${escapeHtml(href)}">${escapeHtml(text || href)}</a>`;
    },
  },
});

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderMarkdown(text: string): string {
  return md.parse(text, { async: false });
}
