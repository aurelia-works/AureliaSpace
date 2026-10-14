/**
 * Risk tags for Claude's permission prompts: a quick read of what the pending tool call
 * would do, shown next to Allow / Deny. Rules only (no model call), from the tool name
 * and the input summary the hook forwards (src-tauri/resources/hook.sh). No imports, so
 * it runs under `node --test`.
 */

export type RiskLevel = "low" | "medium" | "high";

export interface Risk {
  level: RiskLevel;
  why: string;
}

export interface ToolInput {
  command?: string;
  file_path?: string;
  url?: string;
  path?: string;
}

type Rule = [RegExp, string];

const HIGH_COMMANDS: Rule[] = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b|\brm\s+-r\b.*\s(\/|~|\*|\.\.?)(\s|$)/i, "deletes files recursively"],
  [/\bsudo\b/, "runs as root"],
  [/\bgit\s+push\b.*(\s--force\b|\s-f\b|\s--force-with-lease\b|\s\+\S)/, "force-pushes"],
  [/\bgit\s+reset\s+--hard\b/, "throws away uncommitted work"],
  [/\bgit\s+clean\s+-[a-z]*f/, "deletes untracked files"],
  [/\bgit\s+(checkout|restore)\s+(--\s|\.(\s|$)|--worktree)/, "discards local changes"],
  [/\bgit\s+branch\s+-D\b/, "deletes a branch"],
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|)sh\b/, "pipes a download into a shell"],
  [/\bchmod\s+-R\s+777\b/, "opens permissions on a whole tree"],
  [/\b(dd\s+if=|mkfs|diskutil\s+erase)/, "writes to a disk directly"],
  [/\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\bgh\s+release\s+create\b|\btwine\s+upload\b/, "publishes a release"],
  [/\bdrop\s+(table|database|schema)\b|\btruncate\s+table\b/i, "drops data"],
  [/\bsecurity\s+(find|dump)-[\w-]*password\b|\bcat\s+[^|;]*(\.ssh\/id_|\.aws\/credentials|\.netrc)/, "reads secrets"],
  [/(>|tee\s+(-a\s+)?)\s*~?\/?[^\s;|]*(\.zshrc|\.bashrc|\.zprofile|\.ssh\/|\/etc\/)/, "rewrites shell or system config"],
  [/\blaunchctl\s+(load|bootstrap|unload|bootout)\b|\bdefaults\s+write\b/, "changes system settings"],
];

const MEDIUM_COMMANDS: Rule[] = [
  [/\bgit\s+push\b/, "pushes to a remote"],
  [/\bgit\s+(rebase|commit\s+--amend|stash\s+(drop|clear)|tag\s+-d)\b/, "rewrites git history"],
  [/\brm\s/, "deletes files"],
  [/\b(npm|pnpm|yarn)\s+(i|install|add)\s+(-g|--global)\b|\bbrew\s+(install|uninstall|upgrade)\b|\bpip3?\s+install\b|\bcargo\s+install\b/, "installs software"],
  [/\b(curl|wget|ssh|scp|rsync)\b/, "talks to the network"],
  [/\b(kill|pkill|killall)\b/, "stops processes"],
  [/\bdocker\s+(rm|rmi|system\s+prune|compose\s+down)\b/, "removes containers or images"],
  [/\bgh\s+(pr|issue)\s+(create|merge|close|comment)\b/, "acts on GitHub"],
  [/\bmv\s/, "moves files"],
];

const SECRET_PATH = /(^|\/)(\.env(\.|$)|\.ssh\/|\.aws\/|\.netrc$|credentials|id_rsa|id_ed25519|\.npmrc$|\.pypirc$)/;
const SYSTEM_PATH = /^(\/etc\/|\/usr\/|\/System\/|\/Library\/)/;

function firstMatch(rules: Rule[], text: string): string | undefined {
  return rules.find(([re]) => re.test(text))?.[1];
}

function underDir(path: string, dir: string): boolean {
  const d = dir.replace(/\/+$/, "");
  return path === d || path.startsWith(d + "/");
}

/** Risk of the tool call Claude is asking to make, or null when there's nothing to say. */
export function riskOf(tool: string | undefined, input: ToolInput | undefined, cwd?: string): Risk | null {
  if (!tool) return null;
  if (tool === "Bash" && input?.command) {
    const cmd = input.command;
    const high = firstMatch(HIGH_COMMANDS, cmd);
    if (high) return { level: "high", why: high };
    const medium = firstMatch(MEDIUM_COMMANDS, cmd);
    if (medium) return { level: "medium", why: medium };
    return { level: "low", why: "runs a command" };
  }
  if (tool === "Edit" || tool === "Write" || tool === "MultiEdit" || tool === "NotebookEdit") {
    const path = input?.file_path;
    if (!path) return { level: "low", why: "edits a file" };
    if (SECRET_PATH.test(path)) return { level: "high", why: "edits a secrets file" };
    if (SYSTEM_PATH.test(path)) return { level: "high", why: "edits a system file" };
    if (cwd && path.startsWith("/") && !underDir(path, cwd)) return { level: "medium", why: "edits outside this project" };
    return { level: "low", why: tool === "Write" ? "writes a file here" : "edits a file here" };
  }
  if (tool === "Read" && input?.file_path && SECRET_PATH.test(input.file_path)) return { level: "medium", why: "reads a secrets file" };
  if (tool === "WebFetch" && input?.url) {
    try {
      return { level: "low", why: `fetches ${new URL(input.url).host}` };
    } catch {
      return { level: "low", why: "fetches a web page" };
    }
  }
  if (tool.startsWith("mcp__")) return { level: "medium", why: `external tool ${tool.split("__")[1] ?? ""}`.trim() };
  return null;
}
