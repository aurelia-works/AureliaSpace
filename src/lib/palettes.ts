import type { ITheme } from "@xterm/xterm";
import { darkTerminalTheme, lightTerminalTheme } from "./theme";

/** Compact description of one palette variant; UI vars and the xterm theme derive from it. */
interface Variant {
  bg: string;
  chrome: string;
  surface: string;
  s2: string;
  s3: string;
  pane: string;
  border: string;
  bs: string;
  text: string;
  dim: string;
  faint: string;
  accent: string;
  strong: string;
  ink: string;
  ok: string;
  err: string;
  warn: string;
  /** 8 normal + 8 bright ANSI colors. */
  ansi: string[];
}

export interface Palette {
  id: string;
  label: string;
  /** Aurelia keeps the stylesheet defaults and the hand-tuned terminal themes. */
  dark?: Variant;
  light?: Variant;
}

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export const PALETTES: Palette[] = [
  { id: "aurelia", label: "Aurelia" },
  {
    id: "midnight",
    label: "Midnight",
    dark: {
      bg: "#0a0d1a", chrome: "#0f1324", surface: "#141932", s2: "#1b2142", s3: "#242b52", pane: "#0c1020",
      border: "#1f2547", bs: "#2f3869", text: "#dfe5fb", dim: "#98a2cc", faint: "#646e9a",
      accent: "#7c8cff", strong: "#a5b0ff", ink: "#0a0d1f", ok: "#7fd8a0", err: "#ff7a8a", warn: "#ffb26b",
      ansi: ["#1b2142", "#ff7a8a", "#7fd8a0", "#f2cf7a", "#7c8cff", "#c39bff", "#6fd6e8", "#cfd6f2",
        "#4a5380", "#ff9aa7", "#9ae6b6", "#ffe09a", "#9fabff", "#d6b8ff", "#92e6f4", "#f4f6ff"],
    },
    light: {
      bg: "#e4e8f5", chrome: "#ebeef8", surface: "#f3f5fc", s2: "#e6e9f6", s3: "#d9ddf0", pane: "#f8f9fe",
      border: "#d3d8ec", bs: "#bcc3e0", text: "#1c2140", dim: "#545b82", faint: "#8890b3",
      accent: "#4f5fd8", strong: "#3a49b8", ink: "#ffffff", ok: "#2f8a55", err: "#cc3d51", warn: "#bf6b17",
      ansi: ["#1c2140", "#cc3d51", "#2f8a55", "#9a6f10", "#3b52cc", "#8446c4", "#1d7f94", "#a3a9c4",
        "#5c6388", "#e0526a", "#3da368", "#b5851c", "#5468e0", "#9a5cdc", "#2a97ae", "#2c3254"],
    },
  },
  {
    id: "nord",
    label: "Nord",
    dark: {
      bg: "#242933", chrome: "#2a303c", surface: "#2e3440", s2: "#3b4252", s3: "#434c5e", pane: "#2e3440",
      border: "#3b4252", bs: "#4c566a", text: "#d8dee9", dim: "#a5afc2", faint: "#6f7b93",
      accent: "#88c0d0", strong: "#a3d4e2", ink: "#1d2530", ok: "#a3be8c", err: "#d57780", warn: "#d08770",
      ansi: ["#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0",
        "#4c566a", "#d57780", "#b5d0a0", "#f0d9a0", "#94b3d1", "#c6a0c0", "#8fbcbb", "#eceff4"],
    },
    light: {
      bg: "#dfe4ec", chrome: "#e5e9f0", surface: "#eceff4", s2: "#e1e6ee", s3: "#d3dae5", pane: "#f4f6fa",
      border: "#d3d9e4", bs: "#bcc5d4", text: "#2e3440", dim: "#4c566a", faint: "#7d889c",
      accent: "#5e81ac", strong: "#4a6a92", ink: "#ffffff", ok: "#5e8c47", err: "#bf616a", warn: "#c0714f",
      ansi: ["#2e3440", "#bf616a", "#5e8c47", "#a88420", "#5e81ac", "#8f6a89", "#3f8a96", "#a9b2c3",
        "#4c566a", "#d0727b", "#70a05a", "#bf9a2c", "#6f93bf", "#a37ba0", "#4fa0ab", "#3b4252"],
    },
  },
  {
    id: "solarized",
    label: "Solarized",
    dark: {
      bg: "#001f27", chrome: "#00252e", surface: "#002b36", s2: "#073642", s3: "#0d4250", pane: "#002b36",
      border: "#0a3a46", bs: "#1a5361", text: "#93a1a1", dim: "#7a8f92", faint: "#586e75",
      accent: "#cb9a10", strong: "#e0b030", ink: "#002b36", ok: "#859900", err: "#dc322f", warn: "#cb4b16",
      ansi: ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5",
        "#586e75", "#cb4b16", "#8ea600", "#d4a017", "#4aa3e8", "#6c71c4", "#3cbfb5", "#fdf6e3"],
    },
    light: {
      bg: "#eee8d5", chrome: "#f3edda", surface: "#fdf6e3", s2: "#f1ead6", s3: "#e6dfc9", pane: "#fdf6e3",
      border: "#e3dcc4", bs: "#cfc8ae", text: "#4a5f66", dim: "#657b83", faint: "#93a1a1",
      accent: "#b58900", strong: "#8f6c00", ink: "#fdf6e3", ok: "#6d7d00", err: "#dc322f", warn: "#cb4b16",
      ansi: ["#073642", "#dc322f", "#6d7d00", "#b58900", "#268bd2", "#d33682", "#2aa198", "#93a1a1",
        "#586e75", "#cb4b16", "#859900", "#a67c00", "#4aa3e8", "#6c71c4", "#3cbfb5", "#002b36"],
    },
  },
  {
    id: "rose-pine",
    label: "Rosé Pine",
    dark: {
      bg: "#14121f", chrome: "#191724", surface: "#1f1d2e", s2: "#26233a", s3: "#2f2c45", pane: "#191724",
      border: "#26233a", bs: "#403d52", text: "#e0def4", dim: "#908caa", faint: "#6e6a86",
      accent: "#ebbcba", strong: "#f4d3d1", ink: "#191724", ok: "#9ccfd8", err: "#eb6f92", warn: "#f6c177",
      ansi: ["#26233a", "#eb6f92", "#8fc0a4", "#f6c177", "#569fba", "#c4a7e7", "#9ccfd8", "#e0def4",
        "#6e6a86", "#f08aa8", "#a5d0b5", "#f9d49c", "#7bb3cc", "#d3bcee", "#b4dbe3", "#f5f3ff"],
    },
    light: {
      bg: "#efe6dc", chrome: "#f4ece3", surface: "#fffaf3", s2: "#f2e9e1", s3: "#e8ddd2", pane: "#faf4ed",
      border: "#e6dbd0", bs: "#d4c7ba", text: "#575279", dim: "#797593", faint: "#9893a5",
      accent: "#b4637a", strong: "#8f4a60", ink: "#ffffff", ok: "#3d7f6a", err: "#b4637a", warn: "#c07a1c",
      ansi: ["#575279", "#b4637a", "#3d7f6a", "#c07a1c", "#286983", "#907aa9", "#56949f", "#cec6bf",
        "#797593", "#c9788f", "#4f9580", "#ea9d34", "#3a7f9c", "#a58fbd", "#6aa7b2", "#3d3a5c"],
    },
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    dark: {
      bg: "#11111b", chrome: "#181825", surface: "#1e1e2e", s2: "#262637", s3: "#313244", pane: "#1e1e2e",
      border: "#2a2b3c", bs: "#45475a", text: "#cdd6f4", dim: "#a6adc8", faint: "#6c7086",
      accent: "#cba6f7", strong: "#dcc2fb", ink: "#1e1e2e", ok: "#a6e3a1", err: "#f38ba8", warn: "#fab387",
      ansi: ["#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#bac2de",
        "#585b70", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#a6adc8"],
    },
    light: {
      bg: "#dce0e8", chrome: "#e6e9ef", surface: "#eff1f5", s2: "#e6e9ef", s3: "#ccd0da", pane: "#eff1f5",
      border: "#ccd0da", bs: "#bcc0cc", text: "#4c4f69", dim: "#6c6f85", faint: "#9ca0b0",
      accent: "#8839ef", strong: "#6e2ac4", ink: "#ffffff", ok: "#40a02b", err: "#d20f39", warn: "#d9560a",
      ansi: ["#5c5f77", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#ea76cb", "#179299", "#acb0be",
        "#6c6f85", "#e6304f", "#52b43c", "#e9a238", "#4a85f8", "#f08ad6", "#2aa9ae", "#4c4f69"],
    },
  },
];

export function getPalette(id: string | undefined): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

/** Colors for the settings swatch: pane background, accent, text. */
export function swatchColors(p: Palette, dark: boolean): [string, string, string] {
  const v = dark ? p.dark : p.light;
  if (!v) return dark ? ["#121117", "#e9b04b", "#e6e1d6"] : ["#faf8f3", "#b5791f", "#26233a"];
  return [v.pane, v.accent, v.text];
}

function variantOf(p: Palette, dark: boolean) {
  return dark ? p.dark : p.light;
}

export function terminalThemeFor(id: string | undefined, dark: boolean): ITheme {
  const v = variantOf(getPalette(id), dark);
  if (!v) return dark ? darkTerminalTheme : lightTerminalTheme;
  const [black, red, green, yellow, blue, magenta, cyan, white, bBlack, bRed, bGreen, bYellow, bBlue, bMagenta, bCyan, bWhite] = v.ansi;
  return {
    background: v.pane,
    foreground: v.text,
    cursor: v.accent,
    cursorAccent: v.pane,
    selectionBackground: rgba(v.accent, dark ? 0.3 : 0.22),
    scrollbarSliderBackground: rgba(v.text, 0.12),
    scrollbarSliderHoverBackground: rgba(v.text, 0.22),
    scrollbarSliderActiveBackground: rgba(v.accent, 0.38),
    black, red, green, yellow, blue, magenta, cyan, white,
    brightBlack: bBlack, brightRed: bRed, brightGreen: bGreen, brightYellow: bYellow,
    brightBlue: bBlue, brightMagenta: bMagenta, brightCyan: bCyan, brightWhite: bWhite,
  };
}

const VAR_NAMES = [
  "--bg", "--chrome", "--surface", "--surface-2", "--surface-3", "--pane-bg", "--border", "--border-strong",
  "--text", "--text-dim", "--text-faint", "--accent", "--accent-strong", "--accent-soft", "--accent-ink",
  "--ok", "--err", "--warn", "--err-tint", "--shadow",
];

/** Sets the palette's CSS variables on <html>; Aurelia clears them to fall back to styles.css. */
export function applyPaletteVars(id: string | undefined, dark: boolean) {
  const root = document.documentElement;
  const palette = getPalette(id);
  root.dataset.palette = palette.id;
  const v = variantOf(palette, dark);
  if (!v) {
    VAR_NAMES.forEach((n) => root.style.removeProperty(n));
    return;
  }
  const vars: Record<string, string> = {
    "--bg": v.bg, "--chrome": v.chrome, "--surface": v.surface, "--surface-2": v.s2, "--surface-3": v.s3,
    "--pane-bg": v.pane, "--border": v.border, "--border-strong": v.bs,
    "--text": v.text, "--text-dim": v.dim, "--text-faint": v.faint,
    "--accent": v.accent, "--accent-strong": v.strong, "--accent-soft": rgba(v.accent, dark ? 0.14 : 0.13),
    "--accent-ink": v.ink, "--ok": v.ok, "--err": v.err, "--warn": v.warn,
    "--err-tint": rgba(v.err, dark ? 0.07 : 0.06),
    "--shadow": dark
      ? "0 18px 50px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04)"
      : "0 18px 50px rgba(30, 30, 50, 0.22), 0 0 0 1px rgba(0, 0, 0, 0.05)",
  };
  for (const [k, val] of Object.entries(vars)) root.style.setProperty(k, val);
}
