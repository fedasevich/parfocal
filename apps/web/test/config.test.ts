import assert from "node:assert/strict";
import { test } from "node:test";
import { selectWebClients } from "../src/clients.ts";
import { appEnvs, readConfig, type WebConfig } from "../src/config.ts";

test("config needs a known app environment", () => {
  assert.throws(() => readConfig({}), /PARFOCAL_PUBLIC_APP_ENV must be one of/);
  assert.throws(() => readConfig({ PARFOCAL_PUBLIC_APP_ENV: "production" }), /got production/);
  assert.deepEqual(readConfig({ PARFOCAL_PUBLIC_APP_ENV: "dev" }), {
    appEnv: "dev",
    apiBaseUrl: "/api",
  });
});

test("no production web client is created outside prod", () => {
  const created: string[] = [];
  const record =
    <Client>(concern: string, client: Client) =>
    () => {
      created.push(concern);
      return client;
    };
  const factories = {
    errors: record("errors", { capture() {} }),
    analytics: record("analytics", { capture() {} }),
    flags: record("flags", { variant: () => undefined }),
  };
  for (const appEnv of appEnvs.filter((value) => value !== "prod")) {
    const config: WebConfig = { appEnv, apiBaseUrl: "/api" };
    const clients = selectWebClients(config, factories, { "home-variant": "B" });
    assert.equal(clients.flags.variant("home-variant"), "B", appEnv);
  }
  assert.deepEqual(created, []);
  selectWebClients({ appEnv: "prod", apiBaseUrl: "/api" }, factories);
  assert.deepEqual(created, ["errors", "analytics", "flags"]);
});

test("prod fails without production clients", () => {
  assert.throws(
    () => selectWebClients({ appEnv: "prod", apiBaseUrl: "/api" }, {}),
    /no production errors client/,
  );
});
