import assert from "node:assert/strict";
import { test } from "node:test";
import { appEnvs } from "../src/config.ts";
import {
  type DebugHandleHost,
  installDebugHandle,
  parfocalMembers,
  provideDebug,
} from "../src/debug-handle.ts";
import { debugHandle } from "../src/screens/developer/developer-data.ts";

test("the debug handle exists in every build but production", () => {
  for (const appEnv of appEnvs) {
    const host: DebugHandleHost = {};
    assert.equal(installDebugHandle(host, appEnv), appEnv !== "prod", appEnv);
    assert.equal(host.__parfocal !== undefined, appEnv !== "prod", appEnv);
  }
});

test("a screen adds members and takes back only its own", () => {
  const host: DebugHandleHost = {};
  installDebugHandle(host, "dev");
  const first = () => ({ x: 1, y: 2, scale: 3 });
  const removeFirst = provideDebug({ getCamera: first }, host);
  assert.deepEqual(host.__parfocal?.getCamera?.(), { x: 1, y: 2, scale: 3 });
  const second = () => null;
  const removeSecond = provideDebug({ getCamera: second }, host);
  removeFirst();
  assert.equal(host.__parfocal?.getCamera, second);
  removeSecond();
  assert.equal(host.__parfocal?.getCamera, undefined);
});

test("nothing is added to a production page", () => {
  const host: DebugHandleHost = {};
  installDebugHandle(host, "prod");
  provideDebug({ getRoute: () => "viv" }, host)();
  assert.equal(host.__parfocal, undefined);
});

test("the drawer lists the 20 entries of the mock and they match the typed handle", () => {
  const names = debugHandle.flatMap(([members]) =>
    members.split(", ").map((member) => member.replace(/\(.*\)$/, "")),
  );
  assert.equal(debugHandle.length, 20);
  assert.deepEqual(names, [...parfocalMembers]);
});
