import { useAgents } from "../store/agents";

/**
 * The one clock: the title-bar jellyfish and every working thread's bell contract on the same
 * beat, faster the more agents work. A CSS animation does the beating (compositor only); this
 * just sets its tempo on <html> when the number of working agents changes.
 */
export function startPulse() {
  const root = document.documentElement;
  let last = -1;
  const apply = () => {
    const working = Object.values(useAgents.getState().sessions).filter((s) => s.status === "working").length;
    if (working === last) return;
    last = working;
    root.classList.toggle("pulsing", working > 0);
    root.style.setProperty("--beat", `${(60 / (16 + working * 8)).toFixed(2)}s`);
  };
  apply();
  useAgents.subscribe(apply);
}
