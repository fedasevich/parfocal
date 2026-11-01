import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { addImportExtensions } from "../scripts/add-import-extensions.ts";

test("relative imports gain a .ts extension and other imports stay", () => {
  const source = [
    "import { a } from './api';",
    'import type { B } from "../fetcher";',
    "import { c } from './api.ts';",
    "import { http } from 'msw';",
  ].join("\n");
  assert.equal(
    addImportExtensions(source),
    [
      "import { a } from './api.ts';",
      'import type { B } from "../fetcher.ts";',
      "import { c } from './api.ts';",
      "import { http } from 'msw';",
    ].join("\n"),
  );
});

test("the committed MSW handlers import the client with its extension", async () => {
  const source = await readFile(new URL("../src/generated/api.msw.ts", import.meta.url), "utf8");
  assert.equal(addImportExtensions(source), source);
  assert.match(source, /from "\.\/api\.ts"/);
});
