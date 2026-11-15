import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const workflowsDir = join(dirname(dirname(fileURLToPath(import.meta.url))), ".github/workflows");
const workflowFiles = readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name));

test("there are workflows to check", () => {
  assert.ok(workflowFiles.length > 0);
});

for (const name of workflowFiles) {
  test(`${name} pins every job to an explicit Ubuntu version`, () => {
    const lines = readFileSync(join(workflowsDir, name), "utf8").split("\n");
    const runners = lines
      .map((line) => /^\s*runs-on:\s*(\S+)\s*$/.exec(line)?.[1])
      .filter((value): value is string => value !== undefined);
    assert.ok(runners.length > 0);
    for (const runner of runners) {
      assert.match(runner, /^ubuntu-\d{2}\.\d{2}$/, `${name} uses ${runner}`);
    }
    assert.equal(lines.filter((line) => /runs-on:/.test(line)).length, runners.length);
  });
}
