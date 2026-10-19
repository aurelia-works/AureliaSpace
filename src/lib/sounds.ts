import { useConfig } from "../store/config";
import { pickSound } from "./soundPick";

/** What an alert is about; each one can have its own sound, globally or per project. */
export type SoundEvent = "needsHelp" | "yourTurn" | "finished" | "cacheWarning" | "cacheExpired";

export const SOUND_EVENTS: { id: SoundEvent; label: string; hint: string }[] = [
  { id: "needsHelp", label: "Needs your help", hint: "A permission prompt is waiting" },
  { id: "yourTurn", label: "Your turn", hint: "Claude asked you a question" },
  { id: "finished", label: "Turn finished", hint: "Claude is done and waiting" },
  { id: "cacheWarning", label: "Cache about to expire", hint: "5 minutes before the prompt cache cools" },
  { id: "cacheExpired", label: "Cache expired", hint: "The prompt cache just went cold" },
];

export const SOUND_DEFAULTS: Record<SoundEvent, string> = {
  needsHelp: "glass",
  yourTurn: "lantern",
  finished: "marimba",
  cacheWarning: "hourglass",
  cacheExpired: "pebble",
};

let ctx: AudioContext | undefined;
let master: GainNode;
let verb: ConvolverNode;

/** MIDI note -> Hz. */
const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function audio(): AudioContext {
  if (ctx) return ctx;
  ctx = new AudioContext();
  const comp = ctx.createDynamicsCompressor();
  master = ctx.createGain();
  master.connect(comp);
  comp.connect(ctx.destination);
  // A small generated room: decaying noise gives the bells a soft tail.
  const len = ctx.sampleRate * 3;
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  verb = ctx.createConvolver();
  verb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  verb.connect(wet);
  wet.connect(master);
  return ctx;
}

interface ToneOpts {
  gain?: number;
  attack?: number;
  /** How much of the tone also goes through the reverb. */
  room?: number;
  /** Frequency multiplier reached by the end of the tone. */
  glide?: number;
  type?: OscillatorType;
}

function tone(f: number, at: number, dur: number, { gain = 0.2, attack = 0.005, room = 0, glide = 0, type = "sine" }: ToneOpts = {}) {
  const c = audio();
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t);
  if (glide) osc.frequency.exponentialRampToValueAtTime(f * glide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(master);
  if (room) {
    const send = c.createGain();
    send.gain.value = room;
    g.connect(send);
    send.connect(verb);
  }
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export interface Sound {
  id: string;
  name: string;
  desc: string;
  play(): void;
}

export const SOUNDS: Sound[] = [
  {
    id: "glass",
    name: "Glass",
    desc: "A single clear tap on a wine glass",
    play() {
      const f = hz(88);
      [1, 2.76, 5.4].forEach((m, i) => tone(f * m, 0, 1.3 / (i + 1), { gain: 0.12 / (i + 1), room: 0.5 }));
    },
  },
  {
    id: "marimba",
    name: "Marimba",
    desc: "Two warm mallet notes",
    play() {
      for (const [n, t] of [[72, 0], [79, 0.14]]) {
        tone(hz(n), t, 0.55, { gain: 0.25, attack: 0.002, room: 0.2 });
        tone(hz(n) * 4, t, 0.12, { gain: 0.06, attack: 0.002 });
      }
    },
  },
  {
    id: "lantern",
    name: "Lantern",
    desc: "A rising two-note doorbell",
    play() {
      for (const [n, t] of [[76, 0], [83, 0.22]]) {
        tone(hz(n), t, 1.2, { gain: 0.2, room: 0.5 });
        tone(hz(n) * 3, t, 0.4, { gain: 0.04 });
      }
    },
  },
  {
    id: "hourglass",
    name: "Hourglass",
    desc: "Three soft notes stepping down",
    play() {
      [[81, 0], [77, 0.28], [72, 0.56]].forEach(([n, t], i) => tone(hz(n), t, 1.1 - i * 0.2, { type: "triangle", gain: 0.2 - i * 0.04, room: 0.8 }));
    },
  },
  {
    id: "pebble",
    name: "Pebble",
    desc: "A soft water drop",
    play() {
      tone(900, 0, 0.18, { gain: 0.3, attack: 0.003, glide: 0.45, room: 0.3 });
      tone(520, 0.2, 0.22, { gain: 0.14, attack: 0.003, glide: 0.5, room: 0.4 });
    },
  },
];

function setVolume(v: number) {
  audio();
  master.gain.value = Math.pow(Math.min(100, Math.max(0, v)) / 100, 2) * 0.9;
}

/** Plays one sound by id at the given 0-100 volume (the Settings preview passes its draft). */
export function playSound(id: string, volume = useConfig.getState().config?.sounds?.volume ?? 70) {
  const sound = SOUNDS.find((s) => s.id === id);
  if (!sound) return;
  try {
    const c = audio();
    if (c.state === "suspended") void c.resume();
    setVolume(volume);
    sound.play();
  } catch {
    /* sound is best-effort */
  }
}

/** The sound id for an event, honouring per-project overrides. "off" = silent. */
export function soundFor(event: SoundEvent, cwd?: string): string {
  return pickSound(useConfig.getState().config?.sounds, event, SOUND_DEFAULTS[event], cwd);
}

/** Plays the sound set for an alert, unless sounds are off. */
export function playAlert(event: SoundEvent, cwd?: string) {
  if (useConfig.getState().config?.sounds?.enabled === false) return;
  const id = soundFor(event, cwd);
  if (id !== "off") playSound(id);
}

/** Browsers keep audio locked until the page has been touched; any key or click unlocks it. */
export function primeSounds() {
  const unlock = () => {
    const c = audio();
    if (c.state === "suspended") void c.resume();
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
  window.addEventListener("focus", () => ctx?.state === "suspended" && void ctx.resume());
}
