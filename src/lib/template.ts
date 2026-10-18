/** `{{name}}` fields in a saved prompt or command, in first-seen order without repeats. */
export function templateFields(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Fills every `{{name}}` with its value; fields without one are left as written. */
export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (all, name: string) => (values[name] !== undefined ? values[name] : all));
}
