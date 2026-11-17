export type Release = { version: string; date: string; notes: readonly string[] };

const heading = /^## (v\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)\s*$/;
const taskPrefix = /^[A-Z]+-\d+: /;

export function parseReleases(changelog: string, count: number): Release[] {
  const releases: { version: string; date: string; notes: string[] }[] = [];
  let current: { version: string; date: string; notes: string[] } | null = null;
  for (const line of changelog.split("\n")) {
    const match = heading.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      current = { version: match[1], date: match[2], notes: [] };
      releases.push(current);
    } else if (line.startsWith("## ")) {
      current = null;
    } else if (current !== null && line.startsWith("- ")) {
      current.notes.push(line.slice(2).replace(taskPrefix, ""));
    }
  }
  return releases.slice(0, count);
}
