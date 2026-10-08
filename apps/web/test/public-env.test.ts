import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "vite";
import { forbiddenEnvNames, publicEnvOnly } from "../vite/public-env.ts";

async function buildWith(source: string) {
  const root = await mkdtemp(join(tmpdir(), "public-env-"));
  try {
    await writeFile(join(root, "index.html"), '<script type="module" src="/main.ts"></script>');
    await writeFile(join(root, "main.ts"), source);
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      envPrefix: "PARFOCAL_PUBLIC_",
      plugins: [publicEnvOnly()],
      build: { write: false },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("the build fails when code reads a non-public variable", async () => {
  await assert.rejects(
    buildWith("console.log(import.meta.env.DATABASE_URL);"),
    /reads DATABASE_URL from import\.meta\.env/,
  );
});

test("the build fails when code reads the whole env object", async () => {
  await assert.rejects(
    buildWith(
      "const { ZITADEL_CLIENT_SECRET } = import.meta.env; console.log(ZITADEL_CLIENT_SECRET);",
    ),
    /reads import\.meta\.env as a whole/,
  );
});

test("public and built-in variables build", async () => {
  await buildWith(
    "console.log(import.meta.env.PARFOCAL_PUBLIC_APP_ENV, import.meta.env.MODE, import.meta.env.DEV);",
  );
});

test("forbidden names are reported once each", () => {
  assert.deepEqual(
    forbiddenEnvNames(
      "import.meta.env.SECRET; import.meta.env.SECRET; import.meta.env.PARFOCAL_PUBLIC_X; import.meta.env.BASE_URL",
    ),
    ["SECRET"],
  );
});
