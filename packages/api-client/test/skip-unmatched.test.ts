import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { skipUnmatched } from "../src/fake/skip-unmatched.ts";

const cookieReads = (request: Request) => {
  let reads = 0;
  const plainGet = request.headers.get.bind(request.headers);
  request.headers.get = (name) => {
    if (name.toLowerCase() === "cookie") reads += 1;
    return plainGet(name);
  };
  return () => reads;
};

test("a handler for another method or another path reads no cookies", async () => {
  const [byMethod, byPath, matching] = skipUnmatched([
    http.put("http://app.test/slides/:slideId", () => HttpResponse.json({})),
    http.get("http://app.test/tasks/:taskId", () => HttpResponse.json({})),
    http.get("http://app.test/slides/:slideId", () => HttpResponse.json({})),
  ]);
  assert.ok(byMethod && byPath && matching);
  const request = new Request("http://app.test/slides/s1", { headers: { cookie: "seat=7" } });
  const reads = cookieReads(request);

  const otherMethod = await byMethod.parse({ request });
  const otherPath = await byPath.parse({ request });
  assert.equal(otherMethod.match.matches, false);
  assert.equal(otherPath.match.matches, false);
  assert.equal(reads(), 0);

  const parsed = await matching.parse({ request });
  assert.equal(parsed.match.matches, true);
  assert.equal(parsed.match.params?.["slideId"], "s1");
  assert.deepEqual(parsed.cookies, { seat: "7" });
  assert.equal(reads(), 1);
});

const server = setupServer(
  ...skipUnmatched([
    http.post("http://app.test/slides/:slideId", () => HttpResponse.json({ made: true })),
    http.get("http://app.test/slides/:slideId", ({ params, cookies }) =>
      HttpResponse.json({ slide: params["slideId"], seat: cookies["seat"] ?? null }),
    ),
    http.all(/\/anything$/, () => HttpResponse.json({ any: true })),
  ]),
);

before(() => server.listen({ onUnhandledFrame: "error" }));
after(() => server.close());

test("the first handler that fits the method and the path still answers", async () => {
  const read = await fetch("http://app.test/slides/s2", { headers: { cookie: "seat=9" } });
  assert.deepEqual(await read.json(), { slide: "s2", seat: "9" });
  const made = await fetch("http://app.test/slides/s2", { method: "POST" });
  assert.deepEqual(await made.json(), { made: true });
  const any = await fetch("http://app.test/anything", { method: "DELETE" });
  assert.deepEqual(await any.json(), { any: true });
});
