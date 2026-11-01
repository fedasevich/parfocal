import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "oxc-parser";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

export const adoptedDirectories = ["src", "stories"];

export const toolingDirectories = [".storybook", "scripts", "e2e"];

const classRenames: ReadonlyArray<readonly [string, string]> = [
  ["bg-accent", "bg-chrome-2"],
  ["text-accent-foreground", "text-fg"],
  ["text-primary", "text-accent"],
];

type Range = { start: number; end: number };

function parse(filename: string, source: string) {
  const result = parseSync(filename, source);
  if (result.errors.length > 0) {
    throw new Error(`${filename} does not parse: ${result.errors[0]?.message ?? "unknown error"}`);
  }
  return result;
}

function isNode(value: unknown): value is { type: string; start: number; end: number } {
  return typeof value === "object" && value !== null && "type" in value && "start" in value;
}

function emptyJsxContainers(node: unknown, found: Range[]): Range[] {
  if (Array.isArray(node)) {
    for (const child of node) emptyJsxContainers(child, found);
    return found;
  }
  if (typeof node !== "object" || node === null) return found;
  if (isNode(node) && node.type === "JSXExpressionContainer") {
    const expression: unknown = Reflect.get(node, "expression");
    if (isNode(expression) && expression.type === "JSXEmptyExpression") {
      found.push({ start: node.start, end: node.end });
    }
  }
  for (const value of Object.values(node)) emptyJsxContainers(value, found);
  return found;
}

export function findComments(filename: string, source: string): Range[] {
  const result = parse(filename, source);
  const containers = emptyJsxContainers(result.program, []);
  return result.comments.map(({ start, end }) => {
    const container = containers.find((range) => range.start <= start && end <= range.end);
    return container ?? { start, end };
  });
}

function widenToLine(source: string, { start, end }: Range): Range {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = source.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? source.length : nextBreak + 1;
  const before = source.slice(lineStart, start);
  const after = source.slice(end, nextBreak === -1 ? source.length : nextBreak);
  if (before.trim() === "" && after.trim() === "") {
    return { start: lineStart, end: lineEnd };
  }
  let trimmedStart = start;
  while (trimmedStart > lineStart && /[ \t]/.test(source[trimmedStart - 1] ?? "")) {
    trimmedStart -= 1;
  }
  return { start: trimmedStart, end };
}

function mergeRanges(ranges: Range[]): Range[] {
  const merged: Range[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function stripComments(filename: string, source: string): string {
  const ranges = mergeRanges(
    findComments(filename, source).map((range) => widenToLine(source, range)),
  );
  let output = source;
  for (const { start, end } of ranges.reverse()) {
    output = output.slice(0, start) + output.slice(end);
  }
  parse(filename, output);
  return output;
}

export function renameClasses(source: string): string {
  let output = source;
  for (const [from, to] of classRenames) {
    const pattern = new RegExp(`(?<=^|[\\s"'\`:])${from}(?=$|[\\s"'\`/])`, "g");
    output = output.replace(pattern, to);
  }
  return output;
}

export function adoptSource(filename: string, source: string): string {
  return renameClasses(stripComments(filename, source));
}

export function sourceFiles(directories: readonly string[]): string[] {
  return directories.flatMap((directory) =>
    readdirSync(join(packageRoot, directory), { recursive: true, encoding: "utf8" })
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => join(packageRoot, directory, name)),
  );
}

if (import.meta.main) {
  for (const file of sourceFiles(adoptedDirectories)) {
    const source = readFileSync(file, "utf8");
    const adopted = adoptSource(file, source);
    if (adopted !== source) {
      writeFileSync(file, adopted);
      console.log(`adopted ${relative(packageRoot, file)}`);
    }
  }
}
