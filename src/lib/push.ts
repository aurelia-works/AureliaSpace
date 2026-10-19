import { useConfig } from "../store/config";
import type { NoticeKind } from "../store/notifications";

/** What the phone shows when the "include details" option is off: nothing about the project or the prompt. */
const GENERIC: Partial<Record<NoticeKind, string>> = {
  finished: "A Claude pane finished.",
  needs_input: "A Claude pane has a question for you.",
  permission: "A Claude pane needs permission.",
  cache: "A prompt cache is cooling.",
};

/** Kinds worth buzzing a phone for; usage and info cards stay on the Mac. */
const PUSHED: NoticeKind[] = ["finished", "needs_input", "permission", "cache", "limit"];

/** A private topic name: anyone who knows it can read the alerts, so it is long and random. */
export function newTopic(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `aurelia-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function publish(server: string, topic: string, title: string, message: string, priority: number): Promise<string | null> {
  try {
    const res = await fetch(server.replace(/\/+$/, ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, title, message, priority }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? null : `The server answered ${res.status}.`;
  } catch (e) {
    return String(e);
  }
}

/** Sends one alert to the phone, if phone alerts are on. Best-effort: never throws. */
export function pushAlert(kind: NoticeKind, title: string, body?: string) {
  const p = useConfig.getState().config?.push;
  if (!p?.enabled || !p.topic || !PUSHED.includes(kind)) return;
  const urgent = kind === "permission" || kind === "needs_input";
  void publish(p.server || "https://ntfy.sh", p.topic, p.detail ? title : "AureliaSpace", p.detail ? body || title : GENERIC[kind] ?? "Claude needs you.", urgent ? 4 : 3);
}

/** Settings "Send a test": resolves to an error message, or null when it went out. */
export function pushTest(server: string, topic: string): Promise<string | null> {
  if (!topic) return Promise.resolve("Make a topic first.");
  return publish(server || "https://ntfy.sh", topic, "AureliaSpace", "Phone alerts are working.", 3);
}
