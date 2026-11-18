import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { ChecksumError } from "@parfocal/test-fixtures";
import {
  baselineKey,
  fetchBaselines,
  listBaselines,
  parseBaselineList,
  publishBaselines,
  serializeBaselineList,
  type Uploader,
} from "../scripts/visual-baselines.ts";

const sha = (content: string) => createHash("sha256").update(content).digest("hex");

describe("visual baselines", () => {
  let server: Server;
  let origin = "";
  const objects = new Map<string, string>();

  before(async () => {
    server = createServer((request, response) => {
      const body = objects.get(request.url ?? "");
      response.statusCode = body === undefined ? 404 : 200;
      response.end(body);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => server.close());

  test("keys are content addressed", () => {
    assert.equal(baselineKey("abc"), "ui-visual/abc.png");
  });

  test("the list round trips sorted by file name", () => {
    const text = serializeBaselineList([
      { file: "b.png", sha256: "2", bytes: 2 },
      { file: "a.png", sha256: "1", bytes: 1 },
    ]);
    assert.deepEqual(
      parseBaselineList(text).map((entry) => entry.file),
      ["a.png", "b.png"],
    );
  });

  test("listBaselines hashes only the PNG files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "visual-list-"));
    await writeFile(join(dir, "one.png"), "one");
    await writeFile(join(dir, "notes.txt"), "ignored");
    assert.deepEqual(await listBaselines(dir), [{ file: "one.png", sha256: sha("one"), bytes: 3 }]);
  });

  test("publish stores each distinct image once and reports existing ones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "visual-publish-"));
    await writeFile(join(dir, "a.png"), "same");
    await writeFile(join(dir, "b.png"), "same");
    await writeFile(join(dir, "c.png"), "other");
    const taken = new Set([baselineKey(sha("other"))]);
    const stored: string[] = [];
    const upload: Uploader = (key) => {
      if (taken.has(key)) return Promise.resolve("exists");
      stored.push(key);
      return Promise.resolve("stored");
    };
    const result = await publishBaselines(dir, upload);
    assert.equal(result.list.length, 3);
    assert.deepEqual(stored, [baselineKey(sha("same"))]);
    assert.equal(result.stored, 1);
    assert.equal(result.existing, 1);
  });

  test("fetch downloads, verifies and drops files that are not listed", async () => {
    objects.set(`/${baselineKey(sha("pixels"))}`, "pixels");
    const dir = await mkdtemp(join(tmpdir(), "visual-fetch-"));
    await writeFile(join(dir, "stale.png"), "left over");
    const list = [{ file: "story.png", sha256: sha("pixels"), bytes: 6 }];
    const urlFor = (key: string) => `${origin}/${key}`;
    const first = await fetchBaselines(dir, list, urlFor);
    assert.equal(first.downloaded, 1);
    assert.equal(existsSync(join(dir, "stale.png")), false);
    const second = await fetchBaselines(dir, list, urlFor);
    assert.equal(second.cached, 1);
    assert.deepEqual(
      (await readdir(dir)).filter((name) => name.endsWith(".png")),
      ["story.png"],
    );
  });

  test("fetch refuses an object whose checksum differs from the pinned list", async () => {
    objects.set(`/${baselineKey(sha("expected"))}`, "tampered");
    const dir = await mkdtemp(join(tmpdir(), "visual-bad-"));
    await mkdir(dir, { recursive: true });
    const list = [{ file: "story.png", sha256: sha("expected"), bytes: 8 }];
    await assert.rejects(
      fetchBaselines(dir, list, (key) => `${origin}/${key}`),
      ChecksumError,
    );
    assert.equal(existsSync(join(dir, "story.png")), false);
  });
});
