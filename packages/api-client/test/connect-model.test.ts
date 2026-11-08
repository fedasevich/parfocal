import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import { fakeApiHandlers, scenario, setFakeConnectModelScene } from "../src/fake/index.ts";
import { connectLabModel, getLabModelConnection, testLabModel } from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => {
  setFakeConnectModelScene("untested");
});

after(() => {
  server.close();
  globalThis.fetch = patchedFetch;
});

test("an untested connection has the server's address and no answer yet", async () => {
  const { data } = await getLabModelConnection();
  assert.equal(data.address, "https://ml.cuailab.cz/parfocal/infer");
  assert.equal(data.sign_in, "token");
  assert.equal(data.tile_size, 512);
  assert.equal(data.magnification, 40);
  assert.equal(data.test.outcome, "untested");
  assert.deepEqual(data.test.tiles, []);
  assert.deepEqual(
    data.project_ids,
    ["P07", "P09"].map((code) => scenario.projectByCode(code as "P07" | "P09").id),
  );
});

test("a passing test returns two sample tiles and five classes that add up to the first", async () => {
  setFakeConnectModelScene("passed");
  const { data } = await getLabModelConnection();
  assert.equal(data.test.outcome, "follows-contract");
  assert.deepEqual(data.test.returns, ["Regions", "Cells"]);
  assert.equal(data.test.tiles.length, 2);
  const first = data.test.tiles[0];
  assert.equal(first?.answered_ms, 412);
  assert.equal(
    data.test.classes.reduce((sum, item) => sum + item.cells, 0),
    first?.cells,
  );
  assert.equal(data.test.classes.length, first?.classes);
  assert.equal(data.test.classes.filter((item) => item.suggested !== null).length, 4);
  assert.deepEqual(data.test.model, { name: "Lab HoVer-Net fork", version: "v2.1" });
});

test("a failing test names the cells that came back without a geometry", async () => {
  setFakeConnectModelScene("failed");
  const { data } = await getLabModelConnection();
  assert.equal(data.test.outcome, "not-contract");
  assert.equal(data.test.missing_geometry, 38);
  assert.deepEqual(data.test.returns, ["Cells"]);
  assert.deepEqual(data.test.tiles, []);
});

test("a test call answers by the server and connecting keeps the class map and projects", async () => {
  const passing = await testLabModel({
    address: "https://ml.cuailab.cz/parfocal/infer",
    sign_in: "token",
    secret: "secret-3f9a",
  });
  assert.ok(passing.status === 200);
  assert.equal(passing.data.outcome, "follows-contract");
  const failing = await testLabModel({
    address: "https://broken.example.org/infer",
    sign_in: "none",
  });
  assert.ok(failing.status === 200);
  assert.equal(failing.data.outcome, "not-contract");
  assert.equal(failing.data.missing_geometry, 38);
  const projectIds = [scenario.projectByCode("P07").id];
  const connected = await connectLabModel({
    name: "Lab HoVer-Net fork",
    version: "v2.1",
    address: "https://ml.cuailab.cz/parfocal/infer",
    sign_in: "token",
    secret: "secret-3f9a",
    tile_size: 512,
    magnification: 40,
    taxonomy: "sentinel-node",
    class_map: [{ sent: "dead", becomes: null }],
    who_can_run: "admins",
    project_ids: projectIds,
  });
  assert.ok(connected.status === 201);
  const { data } = connected;
  assert.equal(data.host, "ml.cuailab.cz");
  assert.equal(data.last_four, "3f9a");
  assert.deepEqual(data.class_map, [{ sent: "dead", becomes: null }]);
  assert.deepEqual(data.project_ids, projectIds);
});
