/**
 * Rules for the threads sidebar: snooze times, when a PR needs you, the sidebar filter and the
 * message a finished thread hands to the next. Type-only imports, so it runs under `node --test`.
 */
import type { PrInfo } from "./ipc";

export interface SnoozeChoice {
  label: string;
  until: number;
}

const at = (d: Date, days: number, hour: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  x.setHours(hour, 0, 0, 0);
  return x.getTime();
};

/** The snooze menu: an hour, three hours, this evening (only before 5 pm), tomorrow and next Monday morning. */
export function snoozeChoices(now: Date): SnoozeChoice[] {
  const t = now.getTime();
  const out: SnoozeChoice[] = [
    { label: "1 hour", until: t + 3_600_000 },
    { label: "3 hours", until: t + 3 * 3_600_000 },
  ];
  if (now.getHours() < 17) out.push({ label: "This evening", until: at(now, 0, 18) });
  out.push({ label: "Tomorrow morning", until: at(now, 1, 9) });
  // Monday after today (a week ahead when today is Monday).
  out.push({ label: "Next week", until: at(now, ((8 - now.getDay()) % 7) || 7, 9) });
  return out;
}

/** Why a thread's PR needs you, whether or not it's babysat; null when it doesn't. */
export function prAttention(pr: PrInfo | null | undefined, seenFeedback = 0): string | null {
  if (!pr || pr.state !== "OPEN") return null;
  if (pr.checks === "fail") return `checks failed${pr.failing.length ? `: ${pr.failing.join(", ")}` : ""}`;
  if (pr.conflicts) return "conflicts with its base";
  if (pr.review === "CHANGES_REQUESTED") return "changes requested";
  const fresh = pr.feedback - seenFeedback;
  if (fresh > 0) return `${fresh} new review ${fresh === 1 ? "comment" : "comments"}`;
  return null;
}

/** Sidebar filter: every word of the query appears in one of the fields, ignoring case. */
export function matchesFilter(query: string, fields: (string | undefined)[]): boolean {
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

const MAX_REPLY = 1500;

/** What a thread sends the next one when it finishes: who finished, its last reply, then the note. */
export function chainText(from: string, lastReply: string | undefined, note: string): string {
  let reply = lastReply?.trim() ?? "";
  if (reply.length > MAX_REPLY) reply = `${reply.slice(0, MAX_REPLY)}…`;
  return [`Thread "${from}" finished.`, reply && `Its last reply:\n\n${reply}`, note.trim()].filter(Boolean).join("\n\n");
}
