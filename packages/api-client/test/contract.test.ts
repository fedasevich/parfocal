import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  ApiError,
  createProject,
  getHealth,
  getProject,
  listProjects,
  listTaxonomyTemplates,
} from "../src/index.ts";

type Recording = { method: string; path: string; status: number; body: unknown };

type Operation = {
  schemaPath: string;
  call: () => Promise<{ status: number; data: unknown }>;
};

const operations: Record<string, Operation> = {
  health: { schemaPath: "/api/health", call: () => getHealth() },
  "project-created": {
    schemaPath: "/api/projects",
    call: () => createProject({ name: "Contract colon", template: "none" }),
  },
  "project-list": { schemaPath: "/api/projects", call: () => listProjects() },
  "project-read": {
    schemaPath: "/api/projects/{project_id}",
    call: () => getProject("00000000-0000-0000-0000-000000000001"),
  },
  "project-missing": {
    schemaPath: "/api/projects/{project_id}",
    call: () => getProject("00000000-0000-0000-0000-000000000001"),
  },
  "taxonomy-templates": {
    schemaPath: "/api/taxonomy-templates",
    call: () => listTaxonomyTemplates(),
  },
};

type OpenApiResponse = { content?: Record<string, { schema?: object }> };
type OpenApiDocument = {
  paths: Record<string, Record<string, { responses: Record<string, OpenApiResponse> }>>;
};

const openapi = JSON.parse(
  await readFile(new URL("../openapi.json", import.meta.url), "utf8"),
) as OpenApiDocument;

const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
ajv.addSchema(openapi, "openapi");

async function recording(name: string): Promise<Recording> {
  const text = await readFile(new URL(`./recorded/${name}.json`, import.meta.url), "utf8");
  return JSON.parse(text) as Recording;
}

function schemaFor(operation: Operation, recorded: Recording) {
  const response =
    openapi.paths[operation.schemaPath]?.[recorded.method.toLowerCase()]?.responses[
      String(recorded.status)
    ];
  assert.ok(response, `${recorded.method} ${operation.schemaPath} declares no ${recorded.status}`);
  return response.content?.["application/json"]?.schema;
}

function respondWith(recorded: Recording) {
  const problem = recorded.status >= 400;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify(recorded.body), {
        status: recorded.status,
        headers: { "content-type": problem ? "application/problem+json" : "application/json" },
      }),
    );
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

for (const [name, operation] of Object.entries(operations)) {
  test(`the recorded ${name} response matches the committed OpenAPI schema`, async () => {
    const recorded = await recording(name);
    const schema = schemaFor(operation, recorded);
    assert.ok(schema, `${name} has no response schema for status ${recorded.status}`);
    const validate = ajv.compile({
      $ref: `openapi#/paths/${operation.schemaPath.replaceAll("/", "~1")}/${recorded.method.toLowerCase()}/responses/${recorded.status}/content/application~1json/schema`,
    });
    assert.ok(validate(recorded.body), JSON.stringify(validate.errors));
  });

  test(`the generated client turns the recorded ${name} response into typed data`, async () => {
    const recorded = await recording(name);
    respondWith(recorded);
    if (recorded.status >= 400) {
      await assert.rejects(operation.call(), (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, recorded.status);
        assert.deepEqual(error.problem, recorded.body);
        return true;
      });
      return;
    }
    const response = await operation.call();
    assert.equal(response.status, recorded.status);
    assert.deepEqual(response.data, recorded.body);
  });
}

test("the recorded responses hold no real names or addresses", async () => {
  for (const name of Object.keys(operations)) {
    const text = await readFile(new URL(`./recorded/${name}.json`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /@/);
  }
});
