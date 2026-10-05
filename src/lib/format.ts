let home = "";

export function setHome(dir: string) {
  home = dir.replace(/\/+$/, "");
}

export function shortenPath(p?: string): string {
  if (!p) return "";
  if (home && (p === home || p.startsWith(home + "/"))) return "~" + p.slice(home.length);
  return p;
}

export function basename(p?: string): string {
  if (!p) return "";
  if (home && p === home) return "~";
  return p.replace(/\/+$/, "").split("/").pop() || "/";
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  if (m < 60) return `${m}m ${rem.toString().padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${(m % 60).toString().padStart(2, "0")}m`;
}

/** Inverse of shortenPath for typed input: expands a leading `~`. */
export function expandPath(p: string): string {
  const t = p.trim();
  if (home && (t === "~" || t.startsWith("~/"))) return home + t.slice(1);
  return t;
}

/** 1234 -> "1.2k", 1_200_000 -> "1.2M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`;
}

export function formatCost(usd: number): string {
  return usd < 0.01 ? "$0.00" : usd < 100 ? `$${usd.toFixed(2)}` : `$${Math.round(usd)}`;
}
