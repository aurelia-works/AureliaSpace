import type { ITheme } from "@xterm/xterm";

export const darkTerminalTheme: ITheme = {
  background: "#0b0d11",
  foreground: "#e6e3dc",
  cursor: "#f2b544",
  cursorAccent: "#0b0d11",
  selectionBackground: "rgba(242, 181, 68, 0.28)",
  scrollbarSliderBackground: "rgba(236, 232, 225, 0.09)",
  scrollbarSliderHoverBackground: "rgba(236, 232, 225, 0.18)",
  scrollbarSliderActiveBackground: "rgba(242, 181, 68, 0.35)",
  black: "#1b1e25",
  red: "#ff7b72",
  green: "#86d49f",
  yellow: "#f2b544",
  blue: "#7aa7f5",
  magenta: "#c8a0f5",
  cyan: "#62c6de",
  white: "#d9d5cd",
  brightBlack: "#5b606c",
  brightRed: "#ff978f",
  brightGreen: "#a6e6b9",
  brightYellow: "#ffcf75",
  brightBlue: "#9cc0ff",
  brightMagenta: "#dcbcff",
  brightCyan: "#8adcee",
  brightWhite: "#f6f3ec",
};

export const lightTerminalTheme: ITheme = {
  background: "#fbfaf6",
  foreground: "#1d1b21",
  cursor: "#94600a",
  cursorAccent: "#fbfaf6",
  selectionBackground: "rgba(148, 96, 10, 0.18)",
  scrollbarSliderBackground: "rgba(29, 27, 33, 0.11)",
  scrollbarSliderHoverBackground: "rgba(29, 27, 33, 0.2)",
  scrollbarSliderActiveBackground: "rgba(148, 96, 10, 0.38)",
  black: "#1d1b21",
  red: "#be3a30",
  green: "#2c7a44",
  yellow: "#94600a",
  blue: "#2d5fc0",
  magenta: "#8443bd",
  cyan: "#0a7488",
  white: "#a29b8e",
  brightBlack: "#68636e",
  brightRed: "#d6493e",
  brightGreen: "#3a9156",
  brightYellow: "#b0760f",
  brightBlue: "#3d72d8",
  brightMagenta: "#9b58d4",
  brightCyan: "#138ca2",
  brightWhite: "#36333c",
};

const media = window.matchMedia("(prefers-color-scheme: dark)");

export function resolveDark(pref: "system" | "light" | "dark"): boolean {
  return pref === "system" ? media.matches : pref === "dark";
}

export function onSystemThemeChange(cb: () => void): () => void {
  media.addEventListener("change", cb);
  return () => media.removeEventListener("change", cb);
}
