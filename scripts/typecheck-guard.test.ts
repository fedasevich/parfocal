import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const probePath = join(repoRoot, "apps/web/src/typecheck-guard-probe.ts");

function typecheckWebWith(source: string): { status: number | null; output: string } {
  writeFileSync(probePath, source);
  try {
    const result = spawnSync("pnpm", ["--filter", "@parfocal/web", "typecheck"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(probePath, { force: true });
  }
}

test("typecheck fails on an import of a missing export", () => {
  const { status, output } = typecheckWebWith(
    'import { missingExport } from "@parfocal/tokens";\nexport const probe = missingExport;\n',
  );
  assert.notEqual(status, 0);
  assert.match(output, /TS2305/);
});

test("typecheck fails on an import of an undeclared workspace package", () => {
  const { status, output } = typecheckWebWith(
    'import { packageName } from "@parfocal/edge";\nexport const probe = packageName;\n',
  );
  assert.notEqual(status, 0);
  assert.match(output, /TS2307/);
});
