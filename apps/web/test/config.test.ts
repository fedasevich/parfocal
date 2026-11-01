import assert from "node:assert/strict";
import { test } from "node:test";
import { selectWebClients } from "../src/clients.ts";
import { appEnvs, readConfig, readFakeApiMode, type WebConfig } from "../src/config.ts";

test("config needs a known app environment", () => {
  assert.throws(() => readConfig({}), /PARFOCAL_PUBLIC_APP_ENV must be one of/);
  assert.throws(() => readConfig({ PARFOCAL_PUBLIC_APP_ENV: "production" }), /got production/);
  assert.deepEqual(readConfig({ PARFOCAL_PUBLIC_APP_ENV: "dev" }), {
    appEnv: "dev",
    apiBaseUrl: "/api",
    fakeApi: "off",
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
    const config: WebConfig = { appEnv, apiBaseUrl: "/api", fakeApi: "off" };
    const clients = selectWebClients(config, factories, { "home-variant": "B" });
    assert.equal(clients.flags.variant("home-variant"), "B", appEnv);
  }
  assert.deepEqual(created, []);
  selectWebClients({ appEnv: "prod", apiBaseUrl: "/api", fakeApi: "off" }, factories);
  assert.deepEqual(created, ["errors", "analytics", "flags"]);
});

test("prod fails without production clients", () => {
  assert.throws(
    () => selectWebClients({ appEnv: "prod", apiBaseUrl: "/api", fakeApi: "off" }, {}),
    /no production errors client/,
  );
});

test("the fake API is off unless it is asked for", () => {
  assert.equal(readFakeApiMode(undefined, "dev"), "off");
  assert.equal(readFakeApiMode("", "dev"), "off");
  assert.equal(readFakeApiMode("all", "dev"), "all");
  assert.equal(readFakeApiMode("drafts", "test"), "drafts");
  assert.throws(() => readFakeApiMode("yes", "dev"), /must be one of off, all, drafts, got yes/);
});

test("staging and production refuse the fake API", () => {
  for (const appEnv of ["staging", "prod"] as const) {
    assert.equal(readFakeApiMode("off", appEnv), "off");
    assert.throws(
      () => readConfig({ PARFOCAL_PUBLIC_APP_ENV: appEnv, PARFOCAL_PUBLIC_FAKE_API: "all" }),
      new RegExp(`must be off in ${appEnv}`),
    );
  }
});
