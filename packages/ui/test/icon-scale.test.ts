import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const here = (path: string) => new URL(path, import.meta.url).pathname;
const roots = [here("../src"), here("../../../apps/web/src")];
const iconSource = readFileSync(here("../src/components/icon.tsx"), "utf8");
const setSource = readFileSync(here("../src/components/icon-set.tsx"), "utf8");

const scale = [12, 16, 20, 24, 40];
const scaleClasses = new Set(scale.map((px) => `size-${px / 4}`));
const scaleNames = new Set(["xs", "sm", "md", "lg", "xl"]);

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });

const offScale = (text: string, file: string): string[] => {
  const found: string[] = [];
  for (const match of text.matchAll(/<Icon\b[^>]*?\bsize="([^"]+)"/g)) {
    if (!scaleNames.has(match[1] ?? "")) found.push(`${file}: Icon size ${match[1]}`);
  }
  for (const match of text.matchAll(/svg\][^\s"'`]*?:(size|[wh])-([\w.[\]]+)/g)) {
    const cls = `size-${match[2]}`;
    if (match[1] !== "size" || !scaleClasses.has(cls))
      found.push(`${file}: svg ${match[1]}-${match[2]}`);
  }
  for (const match of text.matchAll(/<[A-Z]\w*Icon\b[^>]*?className="([^"]*)"/g)) {
    for (const cls of (match[1] ?? "").split(/\s+/)) {
      if (/^(size|[wh])-/.test(cls) && !scaleClasses.has(cls)) found.push(`${file}: ${cls}`);
    }
  }
  return found;
};

const namesOf = (source: string, block: string): string[] => {
  const start = source.indexOf(block);
  const end = source.indexOf("}", start);
  return [...source.slice(start, end).matchAll(/^ {2}"?([\w-]+)"?:/gm)].map(
    (match) => match[1] ?? "",
  );
};

test("the icon scale is 12, 16, 20, 24 and 40 pixels with matching classes", () => {
  const sizes: [string, number][] = [
    ...(iconSource.match(/const iconSizes = \{([^}]*)\}/)?.[1] ?? "").matchAll(/(\w+): (\d+)/g),
  ].map((match) => [match[1] ?? "", Number(match[2])]);
  assert.deepEqual(
    sizes.map(([, px]) => px),
    scale,
  );
  const classes = [
    ...(iconSource.match(/const sizeClasses = \{([^}]*)\}/)?.[1] ?? "").matchAll(
      /(\w+): "([^"]+)"/g,
    ),
  ].map((match) => [match[1], match[2]]);
  assert.deepEqual(
    classes,
    sizes.map(([name, px]) => [name, `size-${px / 4}`]),
  );
});

test("the size check catches an icon off the scale", () => {
  assert.deepEqual(offScale('<Icon name="check" size="sm" />', "ok.tsx"), []);
  assert.equal(offScale('<Icon name="check" size="huge" />', "bad.tsx").length, 1);
  assert.equal(offScale('className="[&>svg]:size-3.5"', "bad.tsx").length, 1);
  assert.equal(offScale('className="[&_svg]:w-7"', "bad.tsx").length, 1);
  assert.equal(offScale('<XIcon className="pointer-events-none size-7" />', "bad.tsx").length, 1);
});

test("no icon in packages/ui or apps/web is drawn off the scale", () => {
  const found = roots
    .flatMap(sources)
    .flatMap((file) => offScale(readFileSync(file, "utf8"), file));
  assert.deepEqual(found, []);
});

test("every icon in the set uses one stroke width", () => {
  const widths = new Set([...setSource.matchAll(/strokeWidth: ([\d.]+)/g)].map((m) => m[1]));
  assert.deepEqual([...widths], ["1.75"]);
});

test("every icon in the set has an accessible name", () => {
  const names = [...setSource.matchAll(/^ {2}"?([\w-]+)"?: \{/gm)].map((match) => match[1]);
  const labels = namesOf(iconSource, "const iconLabels = {");
  assert.ok(names.length > 60);
  assert.deepEqual(labels.toSorted(), names.toSorted());
  const block = iconSource.slice(iconSource.indexOf("const iconLabels = {"));
  const spoken = [
    ...block.slice(0, block.indexOf("}")).matchAll(/^ {2}"?[\w-]+"?: "([^"]*)",$/gm),
  ].map((match) => match[1]);
  assert.equal(spoken.length, names.length);
  assert.ok(spoken.every((label) => label && label.trim().length > 1));
});
