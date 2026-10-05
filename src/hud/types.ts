/** What the main window sends the HUD (`hud-state`) and what the HUD sends back (`hud-action`). */
export type HudStatus = "starting" | "idle" | "working" | "needs_input";

export interface HudRow {
  paneId: string;
  status: HudStatus;
  attention: boolean;
  account: string;
  folder: string;
  text: string;
  contextPct?: number;
  costUsd?: number;
  hot?: boolean;
  /** Set while a permission prompt is showing in the pane. */
  perm: { always: boolean } | null;
}

export interface HudUsage {
  account: string;
  fiveHour: number | null;
  sevenDay: number | null;
  /** "out in ~1h 40m" when the window would run dry before its reset. */
  fiveEta: string | null;
  sevenEta: string | null;
}

export interface HudSnapshot {
  dark: boolean;
  palette: string;
  rows: HudRow[];
  usage: HudUsage[];
}

export type HudAction = { type: "open"; paneId: string } | { type: "permission"; paneId: string; choice: "allow" | "always" | "deny" };
