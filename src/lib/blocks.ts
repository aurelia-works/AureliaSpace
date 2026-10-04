import type { IMarker, Terminal } from "@xterm/xterm";

/**
 * Groups terminal output into command blocks using the OSC markers emitted by the
 * zsh integration (see src-tauri/resources/integration.zsh):
 *   133;A prompt start · 133;C output start · 133;D;<exit> done
 *   6973;cmd;<b64> command text · 6973;cwd;<b64> working directory
 * Without those markers (vim, ssh, other shells) nothing is tracked and the pane is a
 * plain terminal. Markers are ignored while the alternate screen is active.
 */
export interface Block {
  id: number;
  prompt: IMarker;
  /** 1 when the prompt marker was emitted mid-line; zsh's PROMPT_SP then moves the prompt down a line. */
  promptOffset: number;
  output: IMarker;
  end?: IMarker;
  /** Output didn't end with a newline, so the D marker shares the last output line. */
  endOnSameLine?: boolean;
  command: string;
  cwd?: string;
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
}

export interface BlockRange {
  start: number;
  outputStart: number;
  end: number;
}

const MAX_BLOCKS = 2000;

function decodeB64(s: string): string {
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

export class BlockTracker {
  blocks: Block[] = [];
  running?: Block;
  cwd?: string;
  /** True once the shell integration has announced itself. */
  integrated = false;

  onPrompt?: () => void;
  onCwd?: (cwd: string) => void;
  onCommandStart?: (block: Block) => void;
  onCommandEnd?: (block: Block) => void;

  private pendingPrompt?: IMarker;
  private pendingPromptOffset = 0;
  private pendingCommand = "";
  private nextId = 1;
  private listeners = new Set<() => void>();

  constructor(private term: Terminal) {
    term.parser.registerOscHandler(133, (data) => this.handle133(data));
    term.parser.registerOscHandler(6973, (data) => this.handleAurelia(data));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    this.listeners.forEach((fn) => fn());
  }

  private get inNormalBuffer() {
    return this.term.buffer.active.type === "normal";
  }

  private handle133(data: string): boolean {
    if (!this.inNormalBuffer) return true;
    this.integrated = true;
    const [kind, ...rest] = data.split(";");
    switch (kind) {
      case "A":
        this.promptStart();
        break;
      case "C":
        this.commandStart();
        break;
      case "D":
        this.commandEnd(rest[0]);
        break;
    }
    return true;
  }

  private handleAurelia(data: string): boolean {
    const idx = data.indexOf(";");
    if (idx < 0) return true;
    const key = data.slice(0, idx);
    const value = decodeB64(data.slice(idx + 1));
    if (key === "cmd") {
      this.pendingCommand = value;
    } else if (key === "cwd" && value) {
      this.cwd = value;
      this.onCwd?.(value);
    }
    return true;
  }

  private promptStart() {
    // A prompt without a command (empty Enter, ^C) is simply replaced.
    this.pendingPrompt?.dispose();
    if (this.running) this.commandEnd(undefined);
    this.pendingPrompt = this.term.registerMarker(0);
    this.pendingPromptOffset = this.term.buffer.active.cursorX > 0 ? 1 : 0;
    this.onPrompt?.();
  }

  private commandStart() {
    const output = this.term.registerMarker(0);
    // The prompt marker is gone if the screen was cleared while the prompt was shown.
    const pending = this.pendingPrompt?.isDisposed ? undefined : this.pendingPrompt;
    const prompt = pending ?? this.term.registerMarker(0);
    const promptOffset = pending ? this.pendingPromptOffset : 0;
    this.pendingPrompt = undefined;
    if (!output || !prompt) return;
    const block: Block = {
      id: this.nextId++,
      prompt,
      promptOffset,
      output,
      command: this.pendingCommand.trim(),
      cwd: this.cwd,
      startedAt: performance.now(),
    };
    this.pendingCommand = "";
    // Lines trimmed from scrollback dispose their markers; drop the block with them.
    prompt.onDispose(() => this.remove(block));
    this.blocks.push(block);
    if (this.blocks.length > MAX_BLOCKS) this.remove(this.blocks[0]);
    this.running = block;
    this.onCommandStart?.(block);
    this.changed();
  }

  private commandEnd(code: string | undefined) {
    const block = this.running;
    if (!block) return;
    this.running = undefined;
    block.end = this.term.registerMarker(0);
    block.endOnSameLine = this.term.buffer.active.cursorX > 0;
    block.endedAt = performance.now();
    const n = code === undefined ? NaN : parseInt(code, 10);
    block.exitCode = Number.isNaN(n) ? undefined : n;
    this.onCommandEnd?.(block);
    this.changed();
  }

  private remove(block: Block) {
    const i = this.blocks.indexOf(block);
    if (i < 0) return;
    this.blocks.splice(i, 1);
    if (this.running === block) this.running = undefined;
    block.prompt.dispose();
    block.output.dispose();
    block.end?.dispose();
    this.changed();
  }

  clear() {
    [...this.blocks].forEach((b) => this.remove(b));
  }

  /** Absolute buffer lines covered by a block, or null if it has scrolled away. */
  range(block: Block): BlockRange | null {
    if (block.prompt.isDisposed || block.output.isDisposed) return null;
    const buf = this.term.buffer.active;
    let end: number;
    if (block.end && !block.end.isDisposed) {
      end = block.end.line - (block.endOnSameLine ? 0 : 1);
    } else {
      end = buf.baseY + buf.cursorY;
    }
    const start = Math.min(block.prompt.line + block.promptOffset, block.output.line);
    return { start, outputStart: block.output.line, end: Math.max(end, start) };
  }

  blockAtLine(line: number): Block | undefined {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const r = this.range(this.blocks[i]);
      if (r && line >= r.start && line <= r.end) return this.blocks[i];
    }
    return undefined;
  }

  /** Output text of a block, with soft-wrapped lines joined. */
  outputText(block: Block): string {
    const r = this.range(block);
    if (!r) return "";
    const buf = this.term.buffer.active;
    const lines: string[] = [];
    for (let y = r.outputStart; y <= r.end; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      const text = line.translateToString(true);
      if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    return lines.join("\n");
  }

  recentCommands(n: number): string[] {
    return this.blocks
      .map((b) => b.command)
      .filter(Boolean)
      .slice(-n);
  }

  lastFinished(): Block | undefined {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      if (this.blocks[i].end) return this.blocks[i];
    }
    return undefined;
  }
}
