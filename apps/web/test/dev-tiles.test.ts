import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import type { Connect } from "vite";
import { sendFile } from "../vite/dev-tiles.ts";

type Response = Parameters<Connect.NextHandleFunction>[1];

function fileOf(bytes: string): string {
  const file = join(mkdtempSync(join(tmpdir(), "dev-tiles-")), "slide.tiff");
  writeFileSync(file, bytes);
  return file;
}

function recorder() {
  const stream = new PassThrough();
  const headers = new Map<string, string>();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  const response = Object.assign(stream, {
    statusCode: 200,
    setHeader(name: string, value: number | string) {
      headers.set(name.toLowerCase(), String(value));
      return response;
    },
  });
  const done = new Promise<void>((resolve) => stream.on("finish", resolve));
  return { response, headers, done, body: () => Buffer.concat(chunks).toString() };
}

function requestWith(range: string): Connect.IncomingMessage {
  return { headers: { range } } as Connect.IncomingMessage;
}

test("a range that starts past the end of the file is answered 416 without reading it", async () => {
  const file = fileOf("0123456789");
  const { response, headers, done } = recorder();
  sendFile(file, requestWith("bytes=71494729983852540-"), response as unknown as Response);
  await done;
  assert.equal(response.statusCode, 416);
  assert.equal(headers.get("content-range"), "bytes */10");
});

test("a range that starts at the size of the file is answered 416", async () => {
  const file = fileOf("0123456789");
  const { response, done } = recorder();
  sendFile(file, requestWith("bytes=10-12"), response as unknown as Response);
  await done;
  assert.equal(response.statusCode, 416);
});

test("a range inside the file is answered 206 with its bytes", async () => {
  const file = fileOf("0123456789");
  const { response, headers, done, body } = recorder();
  sendFile(file, requestWith("bytes=2-5"), response as unknown as Response);
  await done;
  assert.equal(response.statusCode, 206);
  assert.equal(headers.get("content-range"), "bytes 2-5/10");
  assert.equal(body(), "2345");
});
