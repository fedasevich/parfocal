import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { selectWebClients } from "../src/clients.ts";
import {
  allowedFields,
  redacted,
  SensitiveValues,
  scrubError,
  scrubFields,
  scrubUrl,
} from "../src/telemetry/scrubbing.ts";
import { learnSensitive, watchSensitiveData } from "../src/telemetry/sensitive-data.ts";

const pythonRules = new URL(
  "../../../packages/py-common/src/parfocal_common/scrubbing.py",
  import.meta.url,
);

test("the web allow-list is the same as the Python one", () => {
  const source = readFileSync(pythonRules, "utf8");
  const block = /ALLOWED_FIELDS = frozenset\(\s*\{([^}]*)\}/u.exec(source)?.[1] ?? "";
  const python = [...block.matchAll(/"([a-z_]+)"/gu)].map((match) => match[1]);
  assert.ok(python.length > 10);
  assert.deepEqual([...allowedFields].sort(), python.sort());
});

test("registered names are redacted ignoring case, spacing and URL encoding", () => {
  const sensitive = new SensitiveValues();
  sensitive.register("Fake  Patient 7", "FAKE-0007", "ab", null, undefined);
  assert.equal(sensitive.redact("Opened fake patient   7 today"), `Opened ${redacted} today`);
  assert.equal(sensitive.redact("/search?q=Fake%20Patient+7"), `/search?q=${redacted}`);
  assert.equal(sensitive.redact("record fake-0007"), `record ${redacted}`);
  assert.equal(sensitive.redact("ab stays"), "ab stays");
  assert.equal(
    sensitive.redact("mail a.b@lab.example and Bearer abc.def"),
    `mail ${redacted} and ${redacted}`,
  );
  sensitive.clear();
  assert.equal(sensitive.redact("Fake Patient 7"), "Fake Patient 7");
});

test("only allow-listed fields keep their values", () => {
  const sensitive = new SensitiveValues();
  sensitive.register("Fake Patient 7");
  assert.deepEqual(
    scrubFields(
      { case_id: "c1", route: "/cases/Fake Patient 7", patient_name: "Fake Patient 7", count: 3 },
      sensitive,
    ),
    { case_id: "c1", route: `/cases/${redacted}`, patient_name: redacted, count: 3 },
  );
});

test("URLs lose their query and fragment", () => {
  const sensitive = new SensitiveValues();
  assert.equal(
    scrubUrl("https://parfocal.eu/search?q=Fake%20Patient#hit", sensitive),
    "https://parfocal.eu/search",
  );
  assert.equal(scrubUrl("/projects/p1/slides/s1", sensitive), "/projects/p1/slides/s1");
});

test("errors keep their type but lose registered values", () => {
  const sensitive = new SensitiveValues();
  sensitive.register("Fake Patient 7");
  const scrubbed = scrubError(new TypeError("No slide for Fake Patient 7"), sensitive);
  assert.equal(scrubbed.name, "TypeError");
  assert.equal(scrubbed.message, `No slide for ${redacted}`);
  assert.ok(!scrubbed.stack?.includes("Fake Patient 7"));
  assert.equal(scrubError("Fake Patient 7 failed", sensitive).message, `${redacted} failed`);
});

test("patient names and record numbers are learned from API data", () => {
  const sensitive = new SensitiveValues();
  learnSensitive(
    [
      { id: "c1", patient: { id: "p1", name: "Fake Patient 1", mrn: "FAKE-0001" } },
      { patient_id: "p2", name: "Fake Patient 2", mrn: null },
      { query: "x", hits: [{ kind: "patient", id: "p3", label: "Fake Patient 3" }] },
      { id: "u1", display_name: "Fake Staff Member" },
      { id: "s1", name: "Slide name is not a person" },
    ],
    sensitive,
  );
  const text = "Fake Patient 1 FAKE-0001 Fake Patient 2 Fake Patient 3 Fake Staff Member";
  assert.equal(sensitive.redact(text), Array(5).fill(redacted).join(" "));
  assert.equal(sensitive.redact("Slide name is not a person"), "Slide name is not a person");
});

test("the query cache teaches the scrubber what it loads and sends", async () => {
  const sensitive = new SensitiveValues();
  const client = new QueryClient();
  const stop = watchSensitiveData(client, sensitive);
  client.setQueryData(["case"], { patient: { name: "Fake Patient 4", mrn: "FAKE-0004" } });
  await client
    .getMutationCache()
    .build(client, { mutationFn: () => Promise.resolve({}) })
    .execute({ patient: { name: "Fake Patient 5" } });
  stop();
  assert.equal(
    sensitive.redact("Fake Patient 4 FAKE-0004 Fake Patient 5"),
    Array(3).fill(redacted).join(" "),
  );
});

test("the console error reporter prints scrubbed errors", (context) => {
  const printed: unknown[] = [];
  context.mock.method(console, "error", (value: unknown) => printed.push(value));
  const clients = selectWebClients({ appEnv: "dev", apiBaseUrl: "/api", fakeApi: "off" }, {});
  clients.sensitive.register("Fake Patient 6");
  clients.errors.capture(new Error("Could not open Fake Patient 6"));
  assert.equal(printed.length, 1);
  assert.ok(printed[0] instanceof Error);
  assert.equal(printed[0].message, `Could not open ${redacted}`);
});

test("production clients receive scrubbed errors and analytics", () => {
  const errors: unknown[] = [];
  const events: unknown[] = [];
  const clients = selectWebClients(
    { appEnv: "prod", apiBaseUrl: "/api", fakeApi: "off" },
    {
      errors: () => ({ capture: (error) => errors.push(error) }),
      analytics: () => ({ capture: (event, properties) => events.push([event, properties]) }),
      flags: () => ({ variant: () => undefined }),
    },
  );
  clients.sensitive.register("Fake Patient 8");
  clients.errors.capture(new Error("Fake Patient 8"));
  clients.analytics.capture("case opened", { case_id: "c1", label: "Fake Patient 8" });
  assert.equal((errors[0] as Error).message, redacted);
  assert.deepEqual(events, [["case opened", { case_id: "c1", label: redacted }]]);
});
