# AureliaSpace: redesign

A redesign of the AureliaSpace frontend for one job: **watching and steering many coding
agents at once without losing the terminal.** The backend, `src/lib/ipc.ts` and every IPC
contract are unchanged. No dependencies were added.

Screenshots are in [`design/screenshots/`](design/screenshots/). See
[How the screenshots were made](#how-the-screenshots-were-made) for exactly what they are.

---

## 1. Design thesis

1. **Gold means "you're needed".** The Aurelia gold (`--attn`) appears only on things that are
   waiting on a person: the needs-you glyph, the pane edge, the beacon, the lane, and the
   Allow button. Primary actions use inverted ink, and keyboard focus uses an ivory/ink ring,
   so neither is ever gold. Working is one cool hue (`--work`), finished is green, idle is ink.
   When you see gold, someone is waiting on you.
2. **State is visible in every mode, not only on the board.** A three-tier frame does this:
   - the **title bar** says where you are (mode, tabs, and a gold beacon with the waiting count);
   - the **status bar** shows the whole fleet as pips, plus the focused pane's location and
     each account's 5h/7d usage;
   - **every pane** shows its state on a 2px top edge and in its header.

   You can tell who needs you from any screen, including a 16-pane grid.
3. **Triage, then act where you are.** The Agents board is sorted into lanes by urgency. Each
   card holds what you need to unblock that agent: the question, the last lines of its output,
   Allow/Always/Deny, and a reply box. Most interruptions can be handled without opening the pane.
4. **Keyboard first, mouse welcome.** ⌘P reaches every pane and action. The board has its own
   single-key model (`↑↓ ↵ Y A N R`). Every README shortcut works as before.
5. **Never cover the terminal.** Status, permission buttons and the ⌘I bar sit above or below
   the terminal, never over its text. The ⌘I bar is now docked under the terminal, which
   refits. Before, it floated over the last lines of output.

## 2. Information architecture

### Before → after

```
BEFORE                                               AFTER
┌ Tab bar: brand · sidebar · tabs · + ✦ ▦ ·          ┌ Title bar: brand · nav · [Agents|Terminals|Review] · tabs · + ✦ ▦ ·
│  [Agents|Terminals|Review] · waiting · 🔔 · ⧉ · ▣ · ⚙│   ◆ N need you ⌘J · Go to… ⌘P · 🔔 · ▣ · ⚙
├ Projects sidebar (⌘\)  │ panes │ Agent panel (⌘B)  ├ Navigator (⌘\ / ⇧⌘F)   │ stage       │ Queue rail (⌘B)
│  + usage strip footer  │       │  agents/tasks/    │   Workspace | Files     │ panes or    │  Needs you / Finished /
├ Files panel (⇧⌘F) as a 2nd column                  │   (one column)          │ Agents board│  Working / Idle, Tasks,
│                                                    │                         │             │  Recent folders
│ Review = centred modal; Settings = page            ├ Status bar: fleet pips · counts · cwd/branch/exit · account fuel
└ (no status bar)                                    └ Review & Settings = pages between the bars; ⌘P palette (new)
```

### What lives where, and why

| Surface | Where | Why there |
| --- | --- | --- |
| Mode switch | Title bar, left of tabs | It's the top-level navigation, so it goes first in reading order. |
| Tabs | Title bar | Each tab shows its index (⌘N), a glyph for its most urgent state, a gold underline if anyone in it needs you, an account and a pane count. Clicking a tab from the board goes to Terminals. |
| "N need you" beacon | Title bar, right | The one global call to action. Clicking it is the same as ⌘J. |
| Fleet pips | Status bar, left | One pip per agent in tab order. Glyph shape plus colour. Click to jump. Always visible. |
| Usage (5h/7d + forecast) | Status bar, right; pane header | Moved from the sidebar footer, so it stays visible when the navigator is closed. |
| Workspace tree + Files | **Navigator** (one left column, two views) | Both answered "where is my stuff". Two side columns cost about 470px; now it's 240px. ⌘\ and ⇧⌘F choose the view or toggle it. |
| Agents, Tasks, Recents | **Queue rail** (⌘B), right | Agents are grouped by urgency (Needs you → Finished → Working → Idle), each with inline Allow/Deny/Reply. Tasks and recents are unchanged. |
| Agents board | Agents mode | Full-width triage across all tabs, including non-Claude panes (Codex/Gemini/shells) in an "Other terminals" lane. |
| Review | Page (was a modal) | It's a mode in the switcher, so it behaves like one. It adds a file index with comment counts. |
| Settings | Page (unchanged position, restyled) | Sections are cards. Palettes show a live swatch for the current light/dark mode. |
| Notices | Bottom-right stack | Finished, needs-input and permission cards are left out of the stack **while the queue is on screen** (rail open or board visible). They still go to the bell history and to macOS notifications. Limit, burn, cache and info cards still appear. Before, a burst could stack 4 cards on top of the rail showing the same agents. |
| Command palette | ⌘P overlay | New. Lists panes (ranked by urgency, then fuzzy-matched) and every action, with key hints. |

## 3. Design tokens

All tokens are in `src/styles/tokens.css`. Palettes in `src/lib/palettes.ts` override the base
set inline on `<html>`. Tints are derived with `color-mix`, so every palette gets them without
extra work.

**Colour, Aurelia "Abyss" (dark) / "Parchment" (light)**

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` / `--chrome` | `#08090c` / `#0e1015` | `#e6e2d8` / `#efece4` | Window / bars and side columns |
| `--surface`, `-2`, `-3` | `#13151b` `#191c23` `#22262f` | `#f8f6f1` `#f0ede5` `#e4dfd3` | Cards, hover, selected |
| `--pane-bg` | `#0b0d11` | `#fbfaf6` | Terminal background (= xterm theme background) |
| `--text` / `-dim` / `-faint` | `#ece8e1` `#a7aab2` `#7d818c` | `#1d1b21` `#55515c` `#6a6570` | Ink ramp |
| `--attn` | `#f2b544` | `#94600a` | **Needs you** (gold) |
| `--work` | `#62c6de` | `#0a7488` | Working |
| `--ok` / `--err` / `--warn` | `#79d29a` `#ff7b72` `#f59e5b` | `#2c7a44` `#be3a30` `#a85a10` | Finished / failure / limits |
| `--primary` | `= --text` | `= --text` | Primary button background (inverted ink) |
| `--focus` | text @70% | text @70% | Focus ring |

The other palettes (Midnight, Nord, Solarized, Rosé Pine, Catppuccin) map `--attn` to their
warm `warn` colour and `--work` to their ANSI cyan, so the gold-means-you rule holds there too.
The xterm theme comes from the same palette entry (`terminalThemeFor`). For Aurelia, the
hand-tuned ANSI themes in `src/lib/theme.ts` were retuned to the new backgrounds.

**Contrast (WCAG ratio, against surface / chrome).** I computed these from the hex values.

| | text | dim | faint | attn | work | ok | err |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dark | 14.9 / 15.6 | 7.9 / 8.2 | 4.7 / 4.9 | 10.0 / 10.4 | 9.3 / 9.7 | 10.0 / 10.4 | 7.2 / 7.5 |
| Light | 15.8 / 14.5 | 7.2 / 6.5 | 5.2 / 4.8 | 4.9 / 4.5 | 5.0 / 4.6 | 4.9 / 4.5 | 5.1 / 4.6 |

The Allow button (ink on gold) is 10.1 in dark and 5.1 in light. Light `--text-faint` on the
outermost `--bg` is 4.4, so text on `--bg` (board lane titles) uses `--text-dim` instead.

**Status glyph:** state is shown by shape as well as colour, so it reads without colour vision.
The glyph is in `StatusGlyph.tsx` and `base.css`, and the HUD reuses it.

| State | Glyph |
| --- | --- |
| needs you | ◆ gold diamond, slow "breathing" halo |
| working | ◠ ring that turns |
| finished | ● green disc |
| idle | ○ hollow ring |
| starting | dashed ring |
| shell | ▫ square, filled while a command runs |

**Type:** SF Pro Text for the UI, SF Mono for data (paths, branches, tails, numbers), with
tabular numerals throughout.

| Role | Size |
| --- | --- |
| Caps labels | 10px |
| Meta | 11px |
| Body | 12.5px |
| Titles | 14px |
| Page titles | 20px |
| Start screen | 28px |

**Space and shape:** spacing is on a 4px grid (`--sp-1…6` = 4/8/12/16/24/32px).

| Element | Radius |
| --- | --- |
| Chips | 4px |
| Controls | 6px |
| Panes | 8px |
| Cards and dialogs | 12px |

| Frame part | Size |
| --- | --- |
| Title bar | 40px |
| Status bar | 26px |
| Pane header | 28px |
| Navigator | 240px |
| Rail | 312px |

**Motion:** 110ms (hover) and 180ms (enter), ease-out, transform and opacity only. There are
only two repeating animations, both on 10px glyphs: the working ring spin and the needs-you
halo. `prefers-reduced-motion` sets both durations to 0 and stops both loops (the splash
already handled this).

## 4. Core surfaces

- **Start screen** (`StartScreen.tsx`): a numbered launch list with provider logos, the folder
  line (Type path… / Choose folder…) and recent folders. `1–9` picks, `↵` opens a terminal.
  Same behaviour as before.
- **Tab bar, split panes, grid tabs:** tabs as described above. Dividers are 5px hit areas with
  a hairline on hover (double-click to even out). ⌘G grid picker restyled; 2–16 panes.
- **Pane header** (`PaneHeader.tsx`), one 28px line:
  - Left: glyph, account chip (click to move the session to another account), folder, path, branch/worktree.
  - Middle: running command or agent state, **inline Allow/Always/Deny while a permission dialog is on screen**, cache timer, attached task.
  - Right: usage, mic, browser/split/close.

  The header uses CSS container queries. Under 520px it drops the path, task, usage and split
  buttons. Under 360px it also drops the branch and cache timer. When a narrow pane is asking
  for permission, the answer buttons take precedence over the folder name.
- **Command blocks** (`BlockOverlay.tsx`, logic untouched): gutter coloured ok/failed/running,
  failed-command tint, and a small hover toolbar on the block's first line.
- **Modes:**
  - **Agents board** (`AgentsBoard.tsx`): header with counts, total tokens and cost. Lanes:
    Needs you, Finished (unseen), Working, Idle, Other terminals. Each card shows: glyph,
    project, account, tab, age, branch, attached task, status line, live 3-line tail of the
    pane's screen (Claude's TUI frame lines are filtered out), permission buttons, reply box
    (placeholder changes: Answer / Follow up / Steer / New prompt), context bar, tokens, cost,
    hand-off, cache.
  - **Terminals.**
  - **Review** (`DiffReview.tsx`): a page with a file index, sticky file headers, click a line
    to comment, overall note, and a target-pane picker. "Send to Claude" is the same message
    format as before.
- **Agent panel → Queue rail** (`QueueRail.tsx`); **Projects sidebar → Navigator** (`Navigator.tsx`,
  `ProjectsSidebar.tsx`, `FilesPanel.tsx`). Projects are sorted by their most urgent pane and
  carry a gold count of panes that need you.
- **Notices / toasts / inline prompt answers** (`Notices.tsx`): cards have a coloured kind rail,
  inline actions (Allow is gold on permission cards) and a reply field. The bell history is
  unchanged. Inline permission answers appear in the pane header, the rail, board cards, notice
  cards and the HUD.
- **Session metrics, limit forecast, hand-off:** `MetricsLine` (context bar, tokens, cost,
  HOT + Hand off), forecast ETA on meters ("out in ~1h"), and hand-off and limit cards.
  Restyled, not changed.
- **⌘I command suggestion** (`SuggestBar.tsx`, logic untouched): docked under the terminal.
- **HUD** (`src/hud/`): same data. It uses the shared tokens and glyphs, has a gold count badge,
  and needs-you rows get a gold rule and a gold Allow.
- **Settings:** every section is kept. Sections are cards, the nav is restyled, and the
  Shortcuts table now includes ⌘P.

## 5. Keyboard model and accessibility

- **Global (⌘ chords, unchanged handler in `src/lib/shortcuts.ts`):** every README shortcut,
  plus **⌘P** command palette.
- **Changes to global shortcuts:**
  - ⇧⌘1 and ⇧⌘2 now also close the Review page.
  - ⌘J now goes through `showPane`, so it switches to Terminals from the board or Review
    instead of focusing a hidden terminal.
- **Agents board:**

  | Key | Action |
  | --- | --- |
  | `↑ ↓ ← →` / `j k h l` | Move the selection |
  | `Home` / `End` | First / last card |
  | `↵` / `o` | Open the pane |
  | `Y` / `A` / `N` | Allow / Always / Deny (when a dialog is showing; the keys are printed on the selected card's buttons) |
  | `R` | Focus the selected card's reply box (`↵` sends, `Esc` leaves) |

  Plain keys only act while the board has focus. ⌘ chords pass through.
- **Palette:** `↑↓` or `⌃N`/`⌃P` to move, `↵` to run, `Esc` to close. It is a combobox with
  `aria-activedescendant`.
- **Start screen and launcher:** the same number keys and arrows as before.
- **Accessibility:**
  - Visible focus ring on every control (`:focus-visible`, ink at 70%).
  - Status is never colour-only (glyph shapes, text labels).
  - ARIA roles on the mode switch (tablist), tabs, navigator tree, file tree and palette
    listbox. Pips and icon buttons have `aria-label`s. The beacon is `aria-live="polite"`.
  - Reduced motion is respected.

## 6. Performance and terminal integrity

- **No subscription changes in the hot path.** The terminal registry, PTY streaming, fit logic,
  links, file drop and block tracking are untouched. PaneView adds one selector that returns a
  primitive state string, so it re-renders only when that pane's state changes.
- **Board tails** read at most one screen of each xterm buffer, on the existing shared 1s
  ticker (`useNow` in `lib/cache.ts`), and only while the board is mounted. There's no
  per-card interval.
- **Board covers the stage instead of replacing it.** It is absolutely positioned over a
  `visibility:hidden` stage instead of a `display:none` one. Terminals keep their size, so
  there's no zero-size refit when switching modes, and panes restored while the app starts in
  Agents mode now spawn. They used to stay unspawned until you visited Terminals, which also
  kept the board's tails and permission detection empty.
- **Cheap animation and layout.** The only continuous animations are two compositor-only
  glyph loops. Container queries keep 16-pane headers legible without JS measuring.
- **The ⌘I bar resizes the terminal through the existing ResizeObserver.** Nothing is drawn
  over terminal text except the pre-existing block gutter and the block hover toolbar.

## 7. Engineering notes

- **Dependencies:** none added. Plain CSS (8 files in `src/styles/`), no CSS-in-JS.
- **Files touched in `src/lib/`.** None of them is an IPC wrapper.
  - `shortcuts.ts`: ⌘P; Navigator view toggles; ⌘J via `showPane`; help text.
  - `palettes.ts`: emits `--attn` and `--work`.
  - `theme.ts`: Aurelia xterm colours retuned to the new backgrounds.
- **Store changes:**
  - `ui.ts`: `sidebarOpen` and `filesOpen` became `nav: "projects" | "files" | null`. An
    existing `ui.json` is migrated on load.
  - `ui.ts`: added `paletteOpen`.
  - No other store changed.
- **New components:** `TitleBar`, `StatusBar`, `Navigator`, `QueueRail` (renamed from
  `AgentPanel`), `CommandPalette`, `StatusGlyph`, and `paneTail.ts`. `TabBar.tsx` was removed.
- **Checks:** `npm run build` passes (`tsc --noEmit` + vite).

## 8. How the screenshots were made

These are **real renders of this branch's React UI**, but not captured from the Tauri window.

- **How they were rendered:** `design/preview/` is a dev-only harness, excluded from
  `npm run build`. It boots the unmodified `src/main.tsx` in headless Chrome (puppeteer-core,
  installed outside the repo) with `@tauri-apps/api/mocks` standing in for the backend.
- **What is scripted:** the scripted PTYs emit the same OSC 133/6973 markers the zsh
  integration emits. Agent states are produced by feeding hook-shaped events through the real
  `useAgents.handle`.
- **What is set directly:** metrics, usage and timestamps are written into the stores.
- **Differences from the app:**
  - The engine is Chrome rather than WKWebView.
  - The DOM xterm renderer is used instead of WebGL.
  - Claude's screens are mock text, not real Claude Code output.

Run it with `npx vite --port 5291`, then open
`/design/preview/?theme=dark|light&view=terminals|board|review|settings|palette|start|files`.

| File | Shows |
| --- | --- |
| `terminals-grid-dark/light.png` | 6-pane grid: 2 needs-you (one permission dialog with header buttons), 2 working, 1 finished, 1 Codex; navigator, queue rail, status bar |
| `agents-board-dark/light.png` | The board with all lanes, live tails, Allow/Always/Deny, reply boxes, HOT + Hand off |
| `review-dark/light.png` | Review page with file index |
| `settings-dark/light.png` | Settings |
| `palette-dark.png` | ⌘P filtered to "api" |
| `start-screen-light.png` | New-tab start screen |
| `files-navigator-dark.png` | Navigator in Files view |

## 9. Known gaps and tradeoffs

- **Not run inside the real Tauri window** in this session: no `tauri dev` and no live Claude
  sessions. The build passes and the UI renders and behaves in the harness. Native-only parts
  are untouched in logic but were not exercised here:
  - traffic-light spacing at 80px;
  - the browser pane's native webview;
  - file drop;
  - the HUD window.
- **Projects and Files can no longer be open at the same time.** That's the cost of the
  single Navigator column.
- **Notice cards for finished, needs-input and permission are left out of the stack while the
  queue is visible.** They're still in the bell history and still sent as macOS notifications
  (the `alertUser` logic is unchanged). If you rely on the cards with the rail open, this is a
  behaviour change.
- **Narrow panes** (under 520px) hide the split and browser buttons and the usage meter. The
  shortcuts and the palette still reach those actions.
- **The Review page's toolbar diff icon was removed from the title bar.** The Review mode tab,
  ⇧⌘R, ⇧⌘3 and the palette remain.
- **Board selection moves linearly** through cards (not 2D by column).
- **Board cards are not individual tab stops.** The board container owns the keyboard, and the
  buttons inside cards are tabbable. A screen reader gets `aria-selected` on the article, but
  not a full listbox/grid pattern.
- **The live tail is screen-scraped** and heuristic (it skips box-drawing lines and Claude's
  shortcut hint). An unusual TUI may show frame text.
- **Fonts:** if SF Mono isn't available to the webview, mono text falls back to JetBrains Mono
  or Menlo.

## 10. Parity checklist

**README shortcuts.** Each was verified by reading the handler in `src/lib/shortcuts.ts` (the
switch is unchanged apart from the lines noted above). ⌘P and the palette were also exercised
in the harness.

| Keys | Action | Status |
| --- | --- | --- |
| ⌘T | New tab (start screen) | ✅ unchanged |
| ⇧⌘1 / ⇧⌘2 / ⇧⌘3 | Agents / Terminals / Review | ✅ (1/2 also close Review) |
| ⌘D / ⇧⌘D | Split right / down | ✅ unchanged |
| ⌘W / ⇧⌘W | Close pane / tab | ✅ unchanged |
| ⌥⌘ arrows | Focus pane in direction (uses `[data-pane-id]` geometry, still unique to panes) | ✅ |
| ⌘1…9, ⇧⌘[ ] | Switch tab | ✅ unchanged |
| ⌘E / ⇧⌘E | Launcher (split / tab) | ✅ unchanged |
| ⌘G | Grid tab 2–16 | ✅ unchanged |
| ⌘J | Jump to longest-waiting agent | ✅ (now also leaves board or Review) |
| ⇧⌘R | Review | ✅ |
| ⇧⌘F | Files | ✅ Navigator → Files view |
| ⌘-click | Open URL or `path:line:col` | ✅ `links.ts` untouched |
| ⌘I | Command suggestion | ✅ docked bar, logic untouched |
| ⌘B | Agent panel | ✅ Queue rail |
| ⇧⌘B | Browser pane | ✅ unchanged |
| ⌘\ | Projects sidebar | ✅ Navigator → Workspace view |
| ⇧⌘↑ / ⇧⌘↓ | Previous / next block | ✅ unchanged |
| ⌘K | Clear | ✅ unchanged |
| ⇧⌘H | HUD | ✅ unchanged |
| ⌥⌘V | Dictate | ✅ unchanged (mic also in pane header) |
| ⌘+ ⌘- ⌘0 | Font size | ✅ unchanged (offset shown in status bar, click to reset) |
| ⌘, | Settings | ✅ |
| ⌘A | Select all in terminal | ✅ unchanged |

**Surfaces**

| Surface | Status |
| --- | --- |
| Start screen | ✅ |
| Tab bar | ✅ |
| Split panes | ✅ |
| Grid tabs | ✅ |
| Pane header: account switch | ✅ |
| Pane header: 5h/7d usage | ✅ |
| Pane header: branch / worktree | ✅ |
| Pane header: cache timer | ✅ |
| Pane header: task | ✅ |
| Pane header: mic | ✅ |
| Pane header: browser / split / close | ✅ |
| Command blocks: gutter | ✅ |
| Command blocks: failed tint | ✅ |
| Command blocks: hover toolbar (copy command, copy output, rerun) | ✅ |
| Command blocks: click gutter to select | ✅ |
| Agents board | ✅ |
| Terminals mode | ✅ |
| Review with line comments | ✅ |
| Agent panel → Queue rail (agents, tasks with run / pin / cycle / delete, recents) | ✅ |
| Projects sidebar → Navigator | ✅ |
| Files panel → Navigator (click inserts the path; open in editor; refresh) | ✅ |
| Notices / toasts / bell history | ✅ |
| Inline permission answers (header, rail, board, notice, HUD) | ✅ |
| Notice reply box | ✅ |
| Session metrics | ✅ |
| Limit forecast | ✅ |
| Hand-off (burn card, metrics line, palette) | ✅ |
| Account switch with transcript move | ✅ |
| ⌘I suggestion bar | ✅ |
| HUD | ✅ |
| Settings: General | ✅ |
| Settings: Appearance (theme and palettes) | ✅ |
| Settings: Accounts | ✅ |
| Settings: Agents | ✅ |
| Settings: Suggestions | ✅ |
| Settings: Voice | ✅ |
| Settings: HUD | ✅ |
| Settings: Integrations | ✅ |
| Settings: Shortcuts | ✅ |
| Browser pane | ✅ (styles moved into `panes.css`) |
| Full Disk Access notice | ✅ |
| Load-in splash | ✅ (`index.html` untouched) |
