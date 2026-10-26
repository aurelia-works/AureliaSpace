import { useAgents } from "../store/agents";
import { useLayout } from "../store/layout";
import { toast } from "../store/ui";
import { useChat } from "./chat";
import { enqueue } from "./outbox";
import { chainText } from "./threads";

/** A thread's name for messages: its chat's first line, else its account. */
export function threadName(paneId: string): string {
  const items = useChat.getState().byPane[paneId]?.transcript.items ?? [];
  const first = items.find((i) => i.kind === "user");
  const title = first?.kind === "user" ? first.text.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  return title || useLayout.getState().panes[paneId]?.account || "Claude";
}

function lastReply(paneId: string): string | undefined {
  const items = useChat.getState().byPane[paneId]?.transcript.items ?? [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "user") return undefined;
    if (it.kind === "text" && it.text.trim()) return it.text;
  }
  return undefined;
}

/** "When this finishes, wake that thread": fires once, on the source's next working → idle. */
export function startChains() {
  useAgents.subscribe((s, prev) => {
    const layout = useLayout.getState();
    for (const [id, pane] of Object.entries(layout.panes)) {
      if (!pane.then) continue;
      const now = s.sessions[id]?.status;
      if (now !== "idle" || prev.sessions[id]?.status !== "working") continue;
      const { paneId: target, text } = pane.then;
      layout.updatePane(id, { then: undefined });
      if (!layout.panes[target]) {
        toast(`"${threadName(id)}" finished, but the thread it should wake is closed.`, true);
        continue;
      }
      enqueue(target, chainText(threadName(id), lastReply(id), text));
      toast(`"${threadName(id)}" finished; woke "${threadName(target)}".`);
    }
  });
}
