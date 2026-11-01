import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));

async function typecheckWrongLinks(): Promise<string> {
  try {
    await promisify(execFile)(
      "pnpm",
      ["exec", "tsc", "--noEmit", "-p", "tsconfig.wrong-links.json"],
      {
        cwd: root,
      },
    );
    return "";
  } catch (error) {
    return String((error as { stdout?: string }).stdout ?? error);
  }
}

test("wrong links fail the typecheck, so the route tree is really typed", async () => {
  const output = await typecheckWrongLinks();
  const errorLines = output
    .split("\n")
    .filter((line) => line.startsWith("test-types/wrong-links.tsx"))
    .map((line) => Number(/\((\d+),/.exec(line)?.[1]));
  for (const line of [4, 5, 10, 12, 13]) {
    assert.ok(errorLines.includes(line), `line ${line} of wrong-links.tsx should fail\n${output}`);
  }
  assert.ok(
    output.split("\n").every((line) => !line.startsWith("src/")),
    `the app itself must typecheck\n${output}`,
  );
});
