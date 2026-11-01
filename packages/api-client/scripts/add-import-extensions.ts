import { readFile, writeFile } from "node:fs/promises";

const relativeImportWithoutExtension = /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.ts)(["'])/g;

export function addImportExtensions(source: string): string {
  return source.replace(relativeImportWithoutExtension, "$1$2.ts$3");
}

if (import.meta.main) {
  for (const file of process.argv.slice(2)) {
    const source = await readFile(file, "utf8");
    const fixed = addImportExtensions(source);
    if (fixed !== source) await writeFile(file, fixed);
  }
}
