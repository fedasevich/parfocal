import assert from "node:assert/strict";
import { test } from "node:test";
import {
  firstGrant,
  type Grant,
  primedGrantLifetimeMs,
  primeGrant,
} from "../src/viewer/tile-grant.ts";

const grantOf = (token: string): Grant => ({
  token,
  lifetimeSeconds: 600,
  basePath: "/tiles/slide/",
  original: "original.tif",
  format: null,
  storage: "uploaded",
  offline: false,
});

function counter(answer: (count: number) => Promise<Grant>) {
  const asked: string[] = [];
  const ask = (slideId: string) => {
    asked.push(slideId);
    return answer(asked.length);
  };
  return { asked, ask };
}

test("the stage takes the grant the route asked for once and asks again after that", async () => {
  const { asked, ask } = counter((count) => Promise.resolve(grantOf(`t${count}`)));
  primeGrant("a", ask, 1_000);
  assert.equal((await firstGrant("a", ask, 1_500)).token, "t1");
  assert.equal((await firstGrant("a", ask, 1_600)).token, "t2");
  assert.deepEqual(asked, ["a", "a"]);
});

test("a primed grant for another slide or past its age is not used", async () => {
  const { asked, ask } = counter((count) => Promise.resolve(grantOf(`t${count}`)));
  primeGrant("a", ask, 1_000);
  assert.equal((await firstGrant("b", ask, 1_100)).token, "t2");
  primeGrant("a", ask, 2_000);
  assert.equal((await firstGrant("a", ask, 2_000 + primedGrantLifetimeMs + 1)).token, "t4");
  assert.deepEqual(asked, ["a", "b", "a", "a"]);
});

test("a primed grant that failed, as before the session is unlocked, is asked for again", async () => {
  const { asked, ask } = counter((count) =>
    count === 1
      ? Promise.reject(new Error("tile-access answered 401"))
      : Promise.resolve(grantOf(`t${count}`)),
  );
  primeGrant("a", ask, 1_000);
  assert.equal((await firstGrant("a", ask, 1_200)).token, "t2");
  assert.deepEqual(asked, ["a", "a"]);
});
