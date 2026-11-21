export function resultSetName(name: string, version: string | null | undefined): string {
  const tag = version?.trim() ?? "";
  if (tag === "" || name.trim().endsWith(tag)) return name.trim();
  return `${name} ${tag}`.trim();
}
