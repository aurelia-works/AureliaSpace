export interface DiffLine {
  kind: "add" | "del" | "ctx" | "hunk";
  text: string;
  /** Line number in the new file (or the old one for deletions). */
  line?: number;
}

export interface DiffFile {
  path: string;
  status: "added" | "deleted" | "modified" | "renamed";
  binary: boolean;
  lines: DiffLine[];
  adds: number;
  dels: number;
}

const stripPrefix = (p: string) => p.replace(/^[ab]\//, "");

/** Parses `git diff` output into files and lines. */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const m = raw.match(/^diff --git (\S+) (\S+)$/);
      file = { path: stripPrefix(m?.[2] ?? raw.slice(11)), status: "modified", binary: false, lines: [], adds: 0, dels: 0 };
      files.push(file);
      continue;
    }
    if (!file) continue;
    if (raw.startsWith("new file")) file.status = "added";
    else if (raw.startsWith("deleted file")) file.status = "deleted";
    else if (raw.startsWith("rename to ")) {
      file.status = "renamed";
      file.path = raw.slice(10);
    } else if (raw.startsWith("Binary files")) file.binary = true;
    else if (raw.startsWith("+++ ")) {
      const p = raw.slice(4);
      if (p !== "/dev/null") file.path = stripPrefix(p);
    } else if (raw.startsWith("--- ") || raw.startsWith("index ") || raw.startsWith("similarity") || raw.startsWith("rename from")) {
      continue;
    } else if (raw.startsWith("@@")) {
      const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      oldNo = Number(m?.[1] ?? 0);
      newNo = Number(m?.[2] ?? 0);
      file.lines.push({ kind: "hunk", text: m?.[3]?.trim() ?? "" });
    } else if (raw.startsWith("+")) {
      file.lines.push({ kind: "add", text: raw.slice(1), line: newNo++ });
      file.adds++;
    } else if (raw.startsWith("-")) {
      file.lines.push({ kind: "del", text: raw.slice(1), line: oldNo++ });
      file.dels++;
    } else if (raw.startsWith(" ")) {
      file.lines.push({ kind: "ctx", text: raw.slice(1), line: newNo++ });
      oldNo++;
    }
  }
  return files;
}
