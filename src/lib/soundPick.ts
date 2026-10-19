/** The slice of the sounds config that picking a sound needs. */
export interface SoundChoices {
  events?: Record<string, string>;
  projects?: Record<string, Record<string, string>>;
}

/** The sound id for an event: the deepest matching project's own choice, else the global one, else `fallback`. */
export function pickSound(s: SoundChoices | undefined, event: string, fallback: string, cwd?: string): string {
  if (!s) return fallback;
  if (cwd) {
    const dir = Object.keys(s.projects ?? {})
      .filter((d) => cwd === d || cwd.startsWith(d.endsWith("/") ? d : `${d}/`))
      .sort((a, b) => b.length - a.length)[0];
    const own = dir && s.projects?.[dir]?.[event];
    if (own) return own;
  }
  return s.events?.[event] ?? fallback;
}
