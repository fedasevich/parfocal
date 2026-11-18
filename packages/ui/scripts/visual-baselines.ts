import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type DownloadResult, downloadFixture, type RemoteFixture } from "@parfocal/test-fixtures";

export type Baseline = { file: string; sha256: string; bytes: number };

export const baselinePrefix = "ui-visual";
export const baselineListPath = new URL("../visual-baselines.json", import.meta.url);
export const baselineDirectory = new URL("../visual/", import.meta.url);

export const baselineKey = (sha256: string) => `${baselinePrefix}/${sha256}.png`;

export function parseBaselineList(text: string): Baseline[] {
  const parsed = JSON.parse(text) as { files: Baseline[] };
  return parsed.files;
}

export function serializeBaselineList(list: readonly Baseline[]): string {
  const files = [...list].sort((a, b) => a.file.localeCompare(b.file));
  return `${JSON.stringify({ files }, null, 2)}\n`;
}

export async function loadBaselineList(path: URL = baselineListPath): Promise<Baseline[]> {
  return parseBaselineList(await readFile(path, "utf8"));
}

export async function listBaselines(dir: string): Promise<Baseline[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".png")).sort();
  return Promise.all(
    names.map(async (file) => {
      const content = await readFile(join(dir, file));
      return {
        file,
        sha256: createHash("sha256").update(content).digest("hex"),
        bytes: content.byteLength,
      };
    }),
  );
}

export function baselineFixture(entry: Baseline, urlFor: (key: string) => string): RemoteFixture {
  return { ...entry, url: urlFor(baselineKey(entry.sha256)), groups: [] };
}

async function inParallel<T>(items: readonly T[], width: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(width, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await work(item);
    }
  });
  await Promise.all(workers);
}

export async function removeUnlisted(dir: string, list: readonly Baseline[]) {
  const kept = new Set(list.flatMap(({ file }) => [file, `${file}.sha256`]));
  for (const name of await readdir(dir)) {
    if (!kept.has(name)) await rm(join(dir, name), { recursive: true, force: true });
  }
}

export async function fetchBaselines(
  dir: string,
  list: readonly Baseline[],
  urlFor: (key: string) => string,
  width = 16,
): Promise<Record<DownloadResult, number>> {
  await mkdir(dir, { recursive: true });
  await removeUnlisted(dir, list);
  const counts: Record<DownloadResult, number> = { cached: 0, linked: 0, downloaded: 0 };
  await inParallel(list, width, async (entry) => {
    counts[await downloadFixture(baselineFixture(entry, urlFor), dir)] += 1;
  });
  return counts;
}

export async function writeBaselineList(list: readonly Baseline[], path: URL = baselineListPath) {
  await writeFile(path, serializeBaselineList(list));
}

export type Uploader = (key: string, body: Buffer) => Promise<"stored" | "exists">;

export async function publishBaselines(
  dir: string,
  upload: Uploader,
  width = 8,
): Promise<{ list: Baseline[]; stored: number; existing: number }> {
  const list = await listBaselines(dir);
  const unique = [...new Map(list.map((entry) => [entry.sha256, entry])).values()];
  let stored = 0;
  let existing = 0;
  await inParallel(unique, width, async (entry) => {
    const outcome = await upload(baselineKey(entry.sha256), await readFile(join(dir, entry.file)));
    if (outcome === "stored") stored += 1;
    else existing += 1;
  });
  return { list, stored, existing };
}
