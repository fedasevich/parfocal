import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const plugin = fileURLToPath(new URL("./lint/raw-jsx-strings.js", import.meta.url));
const folder = mkdtempSync(join(tmpdir(), "raw-jsx-strings-"));
after(() => rmSync(folder, { recursive: true, force: true }));

writeFileSync(
  join(folder, "oxlintrc.json"),
  JSON.stringify({
    categories: { correctness: "off" },
    jsPlugins: [plugin],
    rules: { "parfocal-i18n/no-raw-jsx-strings": "error" },
  }),
);

function lint(name: string, source: string) {
  const file = join(folder, name);
  writeFileSync(file, source);
  const run = spawnSync(
    "pnpm",
    ["-s", "oxlint", "--quiet", "-c", join(folder, "oxlintrc.json"), file],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const output = `${run.stdout}\n${run.stderr}`;
  return { status: run.status, found: output.split("no-raw-jsx-strings").length - 1, output };
}

test("raw text between tags fails the lint", () => {
  const result = lint("text.tsx", "export const A = () => <p>Page not found</p>;\n");
  assert.equal(result.status, 1, result.output);
  assert.equal(result.found, 1);
});

test("raw strings in text props and in braces fail the lint", () => {
  const result = lint(
    "props.tsx",
    [
      "export const A = ({ on }: { on: boolean }) => (",
      '  <button type="button" aria-label="Close" title={on ? "Shown" : "Hidden"}>',
      '    {"Save"}',
      "    {`Saved slide`}",
      "  </button>",
      ");",
      "",
    ].join("\n"),
  );
  assert.equal(result.status, 1, result.output);
  assert.equal(result.found, 5);
});

test("translated text, class names, test ids and symbols pass the lint", () => {
  const result = lint(
    "clean.tsx",
    [
      'import { Trans, useLingui } from "@lingui/react/macro";',
      "export const A = ({ count }: { count: number }) => {",
      "  const { t } = useLingui();",
      "  return (",
      '    <main className="px-8 pt-5" data-testid="clean" title={t`Page not found`}>',
      "      <Trans>Go <b>home</b></Trans>",
      "      {count} / 12 · 100%",
      "    </main>",
      "  );",
      "};",
      "",
    ].join("\n"),
  );
  assert.equal(result.status, 0, result.output);
});

test("the baseline lists only files that still exist, in order", () => {
  const baseline = JSON.parse(
    readFileSync(new URL("./lint/raw-jsx-strings-baseline.json", import.meta.url), "utf8"),
  ) as string[];
  assert.deepEqual(baseline, [...baseline].sort());
  assert.deepEqual(
    baseline.filter((file) => !existsSync(join(repoRoot, file))),
    [],
  );
  assert.equal(baseline.includes("apps/web/src/shell/issue-pages.tsx"), false);
});
