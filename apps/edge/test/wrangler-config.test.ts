import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

type Bindings = {
  name: string;
  workers_dev: boolean;
  routes?: { pattern: string; custom_domain: boolean }[];
  r2_buckets: { binding: string; bucket_name: string }[];
  durable_objects: { bindings: { name: string; class_name: string }[] };
  ratelimits: { name: string; namespace_id: string; simple: { limit: number; period: number } }[];
};
type Config = Bindings & {
  assets: { run_worker_first: boolean; binding: string };
  env: Record<string, Bindings>;
};

const config = JSON.parse(
  readFileSync(fileURLToPath(import.meta.resolve("../wrangler.jsonc")), "utf8"),
) as Config;
const deployed = {
  production: { name: "parfocal-edge", hostname: "app.parfocal.eu", bucket: "parfocal-dev" },
  staging: {
    name: "parfocal-edge-staging",
    hostname: "staging.parfocal.eu",
    bucket: "parfocal-staging",
  },
};

test("every asset passes through the Worker so it gets the isolation headers", () => {
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.assets.binding, "ASSETS");
});

test("each deployed environment repeats every binding the dev Worker has", () => {
  assert.deepEqual(Object.keys(config.env).sort(), Object.keys(deployed).sort());
  for (const [name, expected] of Object.entries(deployed)) {
    const block = config.env[name];
    assert.ok(block);
    assert.equal(block.name, expected.name);
    assert.deepEqual(block.r2_buckets, [{ binding: "SLIDES", bucket_name: expected.bucket }]);
    assert.deepEqual(block.durable_objects, config.durable_objects);
    assert.deepEqual(
      block.ratelimits.map(({ name: binding, simple }) => ({ binding, simple })),
      config.ratelimits.map(({ name: binding, simple }) => ({ binding, simple })),
    );
  }
});

test("each deployed environment is reachable only at its custom domain", () => {
  for (const [name, expected] of Object.entries(deployed)) {
    const block = config.env[name];
    assert.ok(block);
    assert.equal(block.workers_dev, false);
    assert.deepEqual(block.routes, [{ pattern: expected.hostname, custom_domain: true }]);
  }
});

test("no two Workers share a rate limit namespace", () => {
  const namespaces = [config, ...Object.values(config.env)].flatMap((block) =>
    block.ratelimits.map((limit) => limit.namespace_id),
  );
  assert.equal(new Set(namespaces).size, namespaces.length);
});
