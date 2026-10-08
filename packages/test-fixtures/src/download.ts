import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import type { RemoteFixture } from "./manifest.ts";

export type DownloadResult = "cached" | "linked" | "downloaded";

export type DownloadOptions = {
  attempts?: number;
  localDirs?: readonly string[];
};

export class ChecksumError extends Error {}

async function sizeOf(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size;
  } catch {
    return undefined;
  }
}

export async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function readMarker(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return undefined;
  }
}

async function isVerified(fixture: RemoteFixture, target: string, marker: string) {
  if ((await sizeOf(target)) !== fixture.bytes) return false;
  if ((await readMarker(marker)) === fixture.sha256) return true;
  return (await sha256Of(target)) === fixture.sha256;
}

async function linkLocalCopy(fixture: RemoteFixture, target: string, localDirs: readonly string[]) {
  for (const localDir of localDirs) {
    const source = resolve(localDir, fixture.file);
    if ((await sizeOf(source)) !== fixture.bytes) continue;
    if ((await sha256Of(source)) !== fixture.sha256) continue;
    await symlink(source, target);
    return true;
  }
  return false;
}

async function fetchInto(fixture: RemoteFixture, part: string) {
  let offset = (await sizeOf(part)) ?? 0;
  if (offset > fixture.bytes) {
    await rm(part);
    offset = 0;
  }
  if (offset === fixture.bytes) return;
  const response = await fetch(fixture.url, {
    headers: offset > 0 ? { range: `bytes=${offset}-` } : {},
  });
  if (!response.ok || response.body === null) {
    throw new Error(`GET ${fixture.url}: HTTP ${response.status}`);
  }
  const append = offset > 0 && response.status === 206;
  await pipeline(
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
    createWriteStream(part, { flags: append ? "a" : "w" }),
  );
}

export async function downloadFixture(
  fixture: RemoteFixture,
  dir: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const target = join(dir, fixture.file);
  const part = `${target}.part`;
  const marker = `${target}.sha256`;
  await mkdir(dir, { recursive: true });

  if (await isVerified(fixture, target, marker)) {
    await writeFile(marker, `${fixture.sha256}\n`);
    return "cached";
  }
  await rm(target, { force: true });
  await rm(marker, { force: true });

  if (await linkLocalCopy(fixture, target, options.localDirs ?? [])) {
    await writeFile(marker, `${fixture.sha256}\n`);
    return "linked";
  }

  const attempts = options.attempts ?? 5;
  for (let attempt = 1; ; attempt++) {
    try {
      await fetchInto(fixture, part);
      if ((await sizeOf(part)) === fixture.bytes) break;
    } catch (error) {
      if (attempt >= attempts) throw error;
      continue;
    }
    if (attempt >= attempts) {
      throw new Error(`${fixture.file}: still incomplete after ${attempts} attempts`);
    }
  }

  const actual = await sha256Of(part);
  if (actual !== fixture.sha256) {
    await rm(part, { force: true });
    throw new ChecksumError(`${fixture.file}: expected sha256 ${fixture.sha256}, got ${actual}`);
  }
  await rename(part, target);
  await writeFile(marker, `${fixture.sha256}\n`);
  return "downloaded";
}
