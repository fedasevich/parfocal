import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPictureCache,
  pictureStep,
  type SharpPicture,
  wantedPictureWidth,
} from "../src/viewer/peek-picture.ts";

const picture = (src: string, wanted: number): SharpPicture => ({
  src,
  width: wanted,
  height: wanted,
  wanted,
});

test("the wanted width is the dialog times the pixel ratio, rounded up to a step", () => {
  assert.equal(wantedPictureWidth(0, 2), 0);
  assert.equal(wantedPictureWidth(864, 1), 1024);
  assert.equal(wantedPictureWidth(864, 2), 1792);
  assert.equal(wantedPictureWidth(864, 0.5), 1024);
  assert.equal(wantedPictureWidth(pictureStep, 1) % pictureStep, 0);
});

test("a cached picture serves a slide only while it is at least as wide as wanted", () => {
  const cache = createPictureCache(2, () => {});
  cache.store("a", picture("blob:a", 1024));
  assert.equal(cache.find("a", 1024)?.src, "blob:a");
  assert.equal(cache.find("a", 512)?.src, "blob:a");
  assert.equal(cache.find("a", 1792), null);
  assert.equal(cache.find("b", 256), null);
});

test("the cache releases the oldest slide and a replaced picture", () => {
  const released: string[] = [];
  const cache = createPictureCache(2, (item) => released.push(item.src));
  cache.store("a", picture("blob:a", 1024));
  cache.store("b", picture("blob:b", 1024));
  cache.find("a", 1024);
  cache.store("c", picture("blob:c", 1024));
  assert.deepEqual(released, ["blob:b"]);
  cache.store("a", picture("blob:a2", 2048));
  assert.deepEqual(released, ["blob:b", "blob:a"]);
  assert.equal(cache.size(), 2);
});
