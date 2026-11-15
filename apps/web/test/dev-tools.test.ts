import assert from "node:assert/strict";
import { test } from "node:test";
import { devToolsDefine, devToolsFor } from "../vite/dev-tools.ts";

const serve = { command: "serve", isPreview: false } as const;
const preview = { command: "serve", isPreview: true } as const;
const build = { command: "build", isPreview: false } as const;

test("the dev server has developer tools unless the flag turns them off", () => {
  assert.equal(devToolsFor({ ...serve, env: {} }), true);
  assert.equal(devToolsFor({ ...serve, env: { PARFOCAL_PUBLIC_DEV_TOOLS: "off" } }), false);
});

test("a build and its preview have developer tools only when the flag is on", () => {
  assert.equal(devToolsFor({ ...build, env: {} }), false);
  assert.equal(devToolsFor({ ...preview, env: {} }), false);
  assert.equal(devToolsFor({ ...build, env: { PARFOCAL_PUBLIC_DEV_TOOLS: "on" } }), true);
  assert.equal(devToolsFor({ ...preview, env: { PARFOCAL_PUBLIC_DEV_TOOLS: "on" } }), true);
});

test("the flag takes only on or off", () => {
  assert.throws(
    () => devToolsFor({ ...build, env: { PARFOCAL_PUBLIC_DEV_TOOLS: "yes" } }),
    /must be on or off, got yes/,
  );
});

for (const appEnv of ["staging", "prod"]) {
  test(`a ${appEnv} build refuses developer tools`, () => {
    const env = { PARFOCAL_PUBLIC_APP_ENV: appEnv, PARFOCAL_PUBLIC_DEV_TOOLS: "on" };
    assert.throws(() => devToolsFor({ ...build, env }), new RegExp(`must be off in ${appEnv}`));
  });
}

test("the browser sees the resolved flag as on or off", () => {
  assert.deepEqual(devToolsDefine(true), { "import.meta.env.PARFOCAL_PUBLIC_DEV_TOOLS": '"on"' });
  assert.deepEqual(devToolsDefine(false), { "import.meta.env.PARFOCAL_PUBLIC_DEV_TOOLS": '"off"' });
});
