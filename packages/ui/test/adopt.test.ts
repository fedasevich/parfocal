import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  adoptedDirectories,
  adoptSource,
  pointCnAtKit,
  renameClasses,
  sourceFiles,
  stripComments,
  toolingDirectories,
} from "../scripts/adopt.ts";

test("strips line, block and JSX comments", () => {
  const source = [
    "// leading",
    'const url = "https://example.org";',
    "/* block */ const a = 1;",
    "const b = 2; // trailing",
    "const c = <div>{/* jsx */}{/* again */}</div>;",
    "",
  ].join("\n");
  assert.equal(
    stripComments("sample.tsx", source),
    [
      'const url = "https://example.org";',
      " const a = 1;",
      "const b = 2;",
      "const c = <div></div>;",
      "",
    ].join("\n"),
  );
});

test("keeps an object literal that only holds a comment", () => {
  assert.equal(stripComments("sample.ts", "const a = { /* empty */ };\n"), "const a = { };\n");
});

test("renames the shadcn accent classes that clash with the kit's accent", () => {
  assert.equal(
    renameClasses('"focus:bg-accent focus:text-accent-foreground bg-accent/50"'),
    '"focus:bg-chrome-2 focus:text-fg bg-chrome-2/50"',
  );
  assert.equal(renameClasses('"bg-accent-soft text-accent"'), '"bg-accent-soft text-accent"');
});

test("points cn at the kit's configured merge so kit text sizes keep their colours", () => {
  assert.equal(
    pointCnAtKit("src/components/x.tsx", 'import { cn } from "cn";\n'),
    'import { cn } from "@parfocal/ui/lib/utils";\n',
  );
  assert.equal(
    pointCnAtKit("src/lib/utils.ts", 'import { createCn } from "cn/config";\n'),
    'import { createCn } from "cn/config";\n',
  );
});

test("the kit's cn keeps a text colour next to a kit text size", async () => {
  const { cn } = await import("../src/lib/utils.ts");
  assert.equal(cn("text-on-accent", "text-body-sm"), "text-on-accent text-body-sm");
  assert.equal(cn("text-caption", "text-body"), "text-body");
  assert.equal(cn("rounded-ctl", "rounded-zone"), "rounded-zone");
});

test("every component and story is already adopted", () => {
  const files = sourceFiles(adoptedDirectories);
  assert.ok(files.some((file) => file.endsWith("button.tsx")));
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(
      adoptSource(file, source),
      source,
      `${file} has comments, clashing classes or the bare cn import`,
    );
  }
});

test("the Storybook config, scripts and browser tests carry no comments", () => {
  for (const file of sourceFiles(toolingDirectories)) {
    const source = readFileSync(file, "utf8");
    assert.equal(stripComments(file, source), source, `${file} has comments`);
  }
});
