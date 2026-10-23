import { useAgents } from "../store/agents";
import { useConfig } from "../store/config";
import { basename } from "./format";
import { ipc } from "./ipc";

/** A break this long (no agent working) ends a work session; the next work starts the timer over. */
const BREAK_MS = 30 * 60_000;
let startedAt = Math.floor(Date.now() / 1000);
let lastWorking = 0;
/** AureliaSpace's own Discord application ("Playing AureliaSpace"). */
const CLIENT_ID = "1557264613513494598";

/** Pushes Discord Rich Presence from agent state; the backend owns the connection and retries. */
export function startDiscord() {
  let last = "";
  const push = () => {
    const cfg = useConfig.getState().config?.discord;
    let presence = null;
    if (cfg?.enabled) {
      const sessions = Object.values(useAgents.getState().sessions);
      const working = sessions.filter((s) => s.status === "working").length;
      // "Playing for" counts this work session, not how long the app has been open.
      if (working) {
        if (Date.now() - lastWorking > BREAK_MS) startedAt = Math.floor(Date.now() / 1000);
        lastWorking = Date.now();
      }
      const newest = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const project = !cfg.hideProject && newest?.cwd ? basename(newest.cwd) : "";
      const noun = sessions.length === 1 ? "agent" : "agents";
      presence = {
        clientId: CLIENT_ID,
        details: sessions.length ? `Running ${sessions.length} ${noun}` : "Idle in AureliaSpace",
        state: sessions.length ? (project ? `${project} · ${working} working` : `${working} working`) : undefined,
        startedAt,
      };
    }
    const key = JSON.stringify(presence);
    if (key === last) return;
    last = key;
    ipc.discordSet(presence).catch(() => {});
  };
  useAgents.subscribe(push);
  useConfig.subscribe(push);
  push();
}
