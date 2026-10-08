import { useConfig } from "../store/config";
import type { CustomAgent } from "../store/customAgents";
import { useLayout, focusedPaneId, type NewPaneOpts } from "../store/layout";
import { useRecents } from "../store/recents";
import { toast } from "../store/ui";
import { expandPath } from "./format";
import type { Account } from "./ipc";
import { shellQuote, startDir } from "./launch";
import { queueInit } from "./terminals";

/** A CLI binary the launcher can detect (via `which`) and install. */
export interface Tool {
  bin: string;
  install: string;
  docs: string;
}

/** Keychain-backed API key. `id` matches the allowed list in src-tauri/src/agents.rs. */
export interface KeyDef {
  id: string;
  label: string;
  /** Where to create one. */
  url: string;
}

export interface AgentVariant {
  id: string;
  /** Provider id, used for grouping and the logo. */
  provider: string;
  label: string;
  /** Short line under the label: what auth / backend this variant uses. */
  note: string;
  tool: Tool;
  args: string[];
  env: Record<string, string>;
  /** Env var -> API key injected from the Keychain at spawn. */
  secrets: { env: string; key: KeyDef }[];
  /** Claude account (CLAUDE_CONFIG_DIR) for the pane, Claude variants only. */
  account?: string;
  /** User-typed command line instead of a fixed binary. */
  custom?: boolean;
}

export const TOOLS = {
  claude: { bin: "claude", install: "curl -fsSL https://claude.ai/install.sh | bash", docs: "https://docs.claude.com/en/docs/claude-code/overview" },
  codex: { bin: "codex", install: "npm install -g @openai/codex", docs: "https://github.com/openai/codex" },
  gemini: { bin: "gemini", install: "npm install -g @google/gemini-cli", docs: "https://github.com/google-gemini/gemini-cli" },
  grok: { bin: "grok", install: "curl -fsSL https://x.ai/cli/install.sh | bash", docs: "https://x.ai/cli" },
  opencode: { bin: "opencode", install: "curl -fsSL https://opencode.ai/install | bash", docs: "https://opencode.ai/docs" },
  cursor: { bin: "cursor-agent", install: "curl https://cursor.com/install -fsS | bash", docs: "https://cursor.com/docs/cli/overview" },
  copilot: { bin: "copilot", install: "npm install -g @github/copilot", docs: "https://github.com/github/copilot-cli" },
} satisfies Record<string, Tool>;

export const KEYS = {
  openai: { id: "openai", label: "OpenAI API key", url: "https://platform.openai.com/api-keys" },
  gemini: { id: "gemini", label: "Gemini API key", url: "https://aistudio.google.com/apikey" },
  deepseek: { id: "deepseek", label: "DeepSeek API key", url: "https://platform.deepseek.com/api_keys" },
  xai: { id: "xai", label: "xAI API key", url: "https://console.x.ai" },
  cursor: { id: "cursor", label: "Cursor API key", url: "https://cursor.com/dashboard" },
} satisfies Record<string, KeyDef>;

export interface Provider {
  id: string;
  label: string;
  /** Key into AgentLogos. */
  logo: string;
}

export const PROVIDERS: Provider[] = [
  { id: "claude", label: "Claude Code", logo: "claude" },
  { id: "codex", label: "OpenAI Codex", logo: "codex" },
  { id: "gemini", label: "Gemini CLI", logo: "gemini" },
  { id: "grok", label: "Grok", logo: "grok" },
  { id: "deepseek", label: "DeepSeek", logo: "deepseek" },
  { id: "opencode", label: "OpenCode", logo: "opencode" },
  { id: "cursor", label: "Cursor CLI", logo: "cursor" },
  { id: "copilot", label: "GitHub Copilot", logo: "copilot" },
  { id: "custom", label: "Custom", logo: "custom" },
];

export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id)!;

const v = (
  id: string,
  provider: string,
  label: string,
  note: string,
  tool: Tool,
  extra: Partial<Pick<AgentVariant, "args" | "env" | "secrets">> = {},
): AgentVariant => ({ id, provider, label, note, tool, args: [], env: {}, secrets: [], ...extra });

/** All launchable variants. Claude gets one per configured account. */
export function agentVariants(accounts: Account[]): AgentVariant[] {
  return [
    ...accounts.map((a) => ({
      ...v(`claude:${a.name}`, "claude", `Claude · ${a.name}`, "account login", TOOLS.claude),
      account: a.name,
    })),
    v("deepseek:claude", "deepseek", "DeepSeek via Claude Code", "Claude Code on DeepSeek's Anthropic-compatible API", TOOLS.claude, {
      env: { ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic" },
      secrets: [{ env: "ANTHROPIC_AUTH_TOKEN", key: KEYS.deepseek }],
    }),
    v("deepseek:opencode", "deepseek", "DeepSeek via OpenCode", "OpenCode with DEEPSEEK_API_KEY", TOOLS.opencode, {
      secrets: [{ env: "DEEPSEEK_API_KEY", key: KEYS.deepseek }],
    }),
    v("codex:oss", "codex", "Codex · local (Ollama)", "codex --oss, no account or key", TOOLS.codex, { args: ["--oss"] }),
    v("codex:key", "codex", "Codex · API key", "OPENAI_API_KEY, pay per token", TOOLS.codex, {
      secrets: [{ env: "OPENAI_API_KEY", key: KEYS.openai }],
    }),
    v("codex:chatgpt", "codex", "Codex · ChatGPT", "sign in with a ChatGPT plan", TOOLS.codex),
    v("gemini:login", "gemini", "Gemini CLI", "Google sign-in (free tier)", TOOLS.gemini),
    v("gemini:key", "gemini", "Gemini CLI · API key", "GEMINI_API_KEY", TOOLS.gemini, {
      secrets: [{ env: "GEMINI_API_KEY", key: KEYS.gemini }],
    }),
    v("grok:key", "grok", "Grok Build · API key", "GROK_CODE_XAI_API_KEY", TOOLS.grok, {
      secrets: [{ env: "GROK_CODE_XAI_API_KEY", key: KEYS.xai }],
    }),
    v("grok:login", "grok", "Grok Build", "sign in with a SuperGrok plan", TOOLS.grok),
    v("grok:opencode", "grok", "Grok via OpenCode", "OpenCode with XAI_API_KEY", TOOLS.opencode, {
      secrets: [{ env: "XAI_API_KEY", key: KEYS.xai }],
    }),
    v("opencode", "opencode", "OpenCode", "Zen / Go / any provider via /connect", TOOLS.opencode),
    v("cursor", "cursor", "Cursor CLI", "cursor-agent, Cursor login", TOOLS.cursor),
    v("copilot", "copilot", "GitHub Copilot CLI", "needs a Copilot subscription", TOOLS.copilot),
  ];
}

/** A user-typed command (first word is the binary). */
export function customVariant(commandLine: string): AgentVariant {
  const bin = commandLine.trim().split(/\s+/)[0] ?? "";
  return {
    ...v("custom", "custom", "Custom command", "any CLI you type", { bin, install: "", docs: "" }),
    custom: true,
    args: [],
  };
}

/** The line typed into the pane's shell after it starts. */
export function commandLine(variant: AgentVariant, custom: string): string {
  if (variant.custom) return custom.trim();
  const args = variant.args.map((a) => (/^[\w./:=-]+$/.test(a) ? a : shellQuote(a)));
  return [variant.tool.bin, ...args].join(" ");
}

export interface LaunchPlanItem {
  variant: AgentVariant;
  count: number;
  /** Command line for the custom variant. */
  custom?: string;
}

/**
 * Opens one independent pane per requested agent. A single agent can split the focused pane;
 * several always get their own tab laid out as a near-square grid.
 */
export async function launchAgents(plan: LaunchPlanItem[], where: "split" | "tab", folder: string | undefined, worktree: boolean) {
  const layout = useLayout.getState();
  const from = focusedPaneId();
  const total = plan.reduce((n, p) => n + p.count, 0);
  const base = folder ?? (from ? layout.panes[from]?.cwd : undefined);
  const jobs: { opts: NewPaneOpts; command?: string }[] = [];
  let worktreeFailed = false;
  for (const { variant, count, custom } of plan) {
    for (let i = 0; i < count; i++) {
      // One at a time: concurrent `git worktree add` calls fight over the repo lock.
      const cwd = worktree && !worktreeFailed ? await startDir(base, true, `${variant.id.replace(/\W+/g, "-")}-${i + 1}`) : base;
      if (worktree && cwd === base) worktreeFailed = true; // startDir already said why
      jobs.push({
        opts: {
          account: variant.account,
          cwd,
          agent: variant.id,
          env: Object.keys(variant.env).length ? variant.env : undefined,
          secretEnv: variant.secrets.length ? Object.fromEntries(variant.secrets.map((x) => [x.env, x.key.id])) : undefined,
        },
        command: variant.account ? undefined : commandLine(variant, custom ?? ""),
      });
    }
  }
  const lay = useLayout.getState();
  const ids =
    total === 1 && where === "split" && from && lay.panes[from]
      ? [lay.splitPane(from, "row", jobs[0].opts)]
      : lay.newPanesTab(jobs.map((j) => j.opts));
  ids.forEach((id, i) => jobs[i].command && queueInit(id, jobs[i].command!));
  if (base) useRecents.getState().record(base);
  if (worktree && jobs[0]?.opts.cwd !== base) toast(`${total} worktree${total > 1 ? "s" : ""} created next to the repo`);
  return ids;
}

/** The launcher variant a custom agent runs, or undefined if it's gone (e.g. its account was removed). */
export function variantOf(agent: CustomAgent): AgentVariant | undefined {
  if (agent.variant === "custom") return customVariant(agent.command ?? "");
  return agentVariants(useConfig.getState().config?.accounts ?? []).find((v) => v.id === agent.variant);
}

/**
 * Pane options and start command for a custom agent starting from `base`. Makes its worktree
 * when asked. Undefined (after a toast) if the agent's CLI or account no longer exists.
 */
export async function prepareCustomAgent(agent: CustomAgent, base: string | undefined): Promise<{ opts: NewPaneOpts; command?: string } | undefined> {
  const variant = variantOf(agent);
  if (!variant || (variant.custom && !agent.command?.trim())) {
    toast(`${agent.name}: its CLI or account no longer exists. Edit it in Settings → My agents.`, true);
    return undefined;
  }
  const from = agent.folder ? expandPath(agent.folder) : base;
  const cwd = await startDir(from, !!agent.worktree, agent.name.replace(/\W+/g, "-").toLowerCase());
  if (agent.worktree && cwd !== from) toast(`New worktree: ${cwd}`);
  if (from) useRecents.getState().record(from);
  const opts: NewPaneOpts = {
    account: variant.account,
    cwd,
    agent: variant.id,
    customAgent: agent.id,
    env: Object.keys(variant.env).length ? variant.env : undefined,
    secretEnv: variant.secrets.length ? Object.fromEntries(variant.secrets.map((x) => [x.env, x.key.id])) : undefined,
  };
  // Account panes run plain `claude` by default; only override when there are instructions.
  if (variant.account) {
    const instructions = agent.instructions?.trim();
    return { opts, command: instructions ? `claude --append-system-prompt ${shellQuote(instructions)}` : undefined };
  }
  const extra = variant.custom ? "" : (agent.args ?? "").trim();
  return { opts, command: [commandLine(variant, agent.command ?? ""), extra].filter(Boolean).join(" ") };
}

/** Opens one pane running a saved custom agent, labelled with its name and colour. */
export async function launchCustomAgent(agent: CustomAgent, where: "split" | "tab") {
  const from = focusedPaneId();
  const plan = await prepareCustomAgent(agent, from ? useLayout.getState().panes[from]?.cwd : undefined);
  if (!plan) return;
  const lay = useLayout.getState();
  const id = where === "split" && from && lay.panes[from] ? lay.splitPane(from, "row", plan.opts) : lay.newTab(plan.opts);
  if (plan.command) queueInit(id, plan.command);
  return id;
}
