import type { ITheme } from "@xterm/xterm";

export const darkTerminalTheme: ITheme = {
  background: "#121117",
  foreground: "#e6e1d6",
  cursor: "#e9b04b",
  cursorAccent: "#121117",
  selectionBackground: "rgba(233, 176, 75, 0.30)",
  scrollbarSliderBackground: "rgba(230, 225, 214, 0.10)",
  scrollbarSliderHoverBackground: "rgba(230, 225, 214, 0.20)",
  scrollbarSliderActiveBackground: "rgba(233, 176, 75, 0.35)",
  black: "#1d1b22",
  red: "#f0716b",
  green: "#9fd48a",
  yellow: "#e9b04b",
  blue: "#7aa7f0",
  magenta: "#c79bf0",
  cyan: "#6fd3d0",
  white: "#d8d3c8",
  brightBlack: "#5d5866",
  brightRed: "#ff8f88",
  brightGreen: "#b8e6a5",
  brightYellow: "#ffd27a",
  brightBlue: "#9cc0ff",
  brightMagenta: "#dcb8ff",
  brightCyan: "#8fe7e3",
  brightWhite: "#f5f1e8",
};

export const lightTerminalTheme: ITheme = {
  background: "#faf8f3",
  foreground: "#26232b",
  cursor: "#b5791f",
  cursorAccent: "#faf8f3",
  selectionBackground: "rgba(185, 121, 42, 0.22)",
  scrollbarSliderBackground: "rgba(38, 35, 43, 0.12)",
  scrollbarSliderHoverBackground: "rgba(38, 35, 43, 0.22)",
  scrollbarSliderActiveBackground: "rgba(185, 121, 42, 0.40)",
  black: "#26232b",
  red: "#c8413b",
  green: "#3f8a3a",
  yellow: "#a86f12",
  blue: "#2f62c4",
  magenta: "#8d4bc4",
  cyan: "#1f8282",
  white: "#a9a296",
  brightBlack: "#6b6573",
  brightRed: "#e0534c",
  brightGreen: "#4fa349",
  brightYellow: "#c4861c",
  brightBlue: "#3f76de",
  brightMagenta: "#a35fdc",
  brightCyan: "#2a9a9a",
  brightWhite: "#3a3640",
};

const media = window.matchMedia("(prefers-color-scheme: dark)");

export function resolveDark(pref: "system" | "light" | "dark"): boolean {
  return pref === "system" ? media.matches : pref === "dark";
}

export function onSystemThemeChange(cb: () => void): () => void {
  media.addEventListener("change", cb);
  return () => media.removeEventListener("change", cb);
}
