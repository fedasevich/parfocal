export type Release = { version: string; date: string; notes: readonly string[] };

const heading = /^## (v\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)\s*$/;
const taskPrefix = /^[A-Z]+-\d+: /;
const taskInParentheses = /\s*\([A-Z]+-\d+(?:[, ]+[A-Z]+-\d+)*\)/g;
const taskId = /\b[A-Z]{2,}-\d+\b/g;
const userFacingSections = new Set(["Features", "Fixes", "Performance"]);
const internalStart =
  /^(merge|log|claim|tick|audit|ask|wait for|drop an unused|add the task|tie off|make main's|make .* (pass|green))\b/i;
const internalWord = /\b(ci|specs?|seed|backlog|golden|unit tests?|lint|typecheck)\b/i;

export function userFacing(note: string): string | null {
  const text = note
    .replace(taskPrefix, "")
    .replace(taskInParentheses, "")
    .replace(taskId, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (text === "" || internalStart.test(text) || internalWord.test(text)) return null;
  return text;
}

export function newestVersion(changelog: string): string {
  for (const line of changelog.split("\n")) {
    const match = heading.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return "";
}

export function parseReleases(changelog: string, count = Infinity): Release[] {
  const releases: { version: string; date: string; notes: string[] }[] = [];
  let current: { version: string; date: string; notes: string[] } | null = null;
  let section: string | null = null;
  for (const line of changelog.split("\n")) {
    const match = heading.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      current = { version: match[1], date: match[2], notes: [] };
      section = null;
      releases.push(current);
    } else if (line.startsWith("## ")) {
      current = null;
    } else if (line.startsWith("### ")) {
      section = line.slice(4).trim();
    } else if (current !== null && line.startsWith("- ")) {
      if (section !== null && !userFacingSections.has(section)) continue;
      const note = userFacing(line.slice(2));
      if (note !== null && !current.notes.includes(note)) current.notes.push(note);
    }
  }
  return releases.filter((release) => release.notes.length > 0).slice(0, count);
}
