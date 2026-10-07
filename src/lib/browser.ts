import { activeTab, paneIds, useLayout } from "../store/layout";

/** Turns address-bar input into a URL: bare hosts get a scheme, anything else becomes a search. */
export function normalizeUrl(input: string): string {
  const t = input.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[\da-f:]+\])(:\d+)?([/?#]|$)/i.test(t)) return `http://${t}`;
  if (!/\s/.test(t) && /\.[a-z]{2,}([:/?#]|$)/i.test(t)) return `https://${t}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`;
}

export const isLocalUrl = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?([/?#]|$)/i.test(url);

/** Opens `url` in a browser pane: reuses one in the same tab as `fromPane`, else splits right. */
export function openInBrowserPane(fromPane: string | undefined, url: string) {
  const layout = useLayout.getState();
  const tab = (fromPane && layout.tabs.find((t) => paneIds(t.root).includes(fromPane))) || activeTab();
  const existing = tab && paneIds(tab.root).find((id) => layout.panes[id]?.browser);
  if (existing) {
    if (url) layout.updatePane(existing, { browser: { url } });
    layout.focusPane(existing);
    return existing;
  }
  const from = fromPane ?? tab?.focusedPaneId;
  return from ? layout.splitPane(from, "row", { browserUrl: url }) : layout.newTab({ browserUrl: url });
}
