/**
 * What babysitting a thread's PR should do when the PR changes: wake the agent with what
 * went wrong, settle the thread once the PR merges, or nothing. Rules only, and type-only
 * imports, so it runs under `node --test`.
 */
import type { PrInfo } from "./ipc";

/** Wakes per thread before babysitting hands back to you (a loop once spent 8 hours on 3 comments). */
export const MAX_WAKES = 8;

export type PrAction = { kind: "none" } | { kind: "settle" } | { kind: "wake"; text: string };

/** What's wrong with the PR, phrased for the agent: everything now, or with `prev` only what changed since. */
export function prProblems(pr: PrInfo, prev?: PrInfo): string[] {
  const out: string[] = [];
  if (pr.checks === "fail" && (!prev || prev.checks !== "fail" || pr.failing.join() !== prev.failing.join()))
    out.push(`checks failed (${pr.failing.join(", ") || "see gh pr checks"})`);
  if (pr.conflicts && !prev?.conflicts) out.push("the branch conflicts with its base");
  const fresh = prev ? pr.feedback - prev.feedback : 0;
  if (pr.review === "CHANGES_REQUESTED" && prev?.review !== "CHANGES_REQUESTED") out.push("a reviewer requested changes");
  else if (fresh > 0) out.push(`${fresh} new review ${fresh === 1 ? "comment" : "comments"}`);
  return out;
}

export function wakeText(pr: PrInfo, problems: string[]): string {
  return [
    `PR #${pr.number} (${pr.url}) needs another pass: ${problems.join("; ")}.`,
    `Read it with \`gh pr view ${pr.number} --comments\` and \`gh pr checks ${pr.number}\`.`,
    "Fix what matters and say briefly why you skip the rest, run the affected tests, then commit and push this branch.",
    "Reply on the review comments you addressed. Don't merge; that stays with me.",
  ].join(" ");
}

/** First message when babysitting starts: get a PR up, or work on what's already wrong; null when there's nothing to say. */
export function kickoffText(pr: PrInfo | null): string | null {
  if (!pr || pr.state !== "OPEN")
    return "Babysit this branch: commit your finished work, push the branch and open a PR with `gh pr create --fill` if it has none. I'll wake you when checks fail, reviews arrive or it conflicts. Don't merge; that stays with me.";
  const problems = prProblems(pr);
  return problems.length ? wakeText(pr, problems) : null;
}

/** Compares the last PR read with the new one. Only changes wake: a known failure doesn't repeat. */
export function prAction(prev: PrInfo | null | undefined, next: PrInfo | null, babysit: boolean): PrAction {
  if (!next) return { kind: "none" };
  if (next.state === "MERGED" && prev?.state !== "MERGED") return { kind: "settle" };
  if (!babysit || !prev || prev.number !== next.number || next.state !== "OPEN") return { kind: "none" };
  const problems = prProblems(next, prev);
  return problems.length ? { kind: "wake", text: wakeText(next, problems) } : { kind: "none" };
}
