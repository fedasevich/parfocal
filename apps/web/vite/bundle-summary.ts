import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

export interface ChunkInput {
  readonly fileName: string;
  readonly code: string;
  readonly isEntry: boolean;
  readonly imports: readonly string[];
  readonly modules: Readonly<Record<string, number>>;
}

export interface ModuleEntry {
  readonly id: string;
  readonly bytes: number;
}

export interface PackageEntry {
  readonly name: string;
  readonly bytes: number;
}

export interface ChunkSummary {
  readonly fileName: string;
  readonly firstPage: boolean;
  readonly bytes: number;
  readonly gzipBytes: number;
  readonly modules: readonly ModuleEntry[];
}

export interface BundleSummary {
  readonly totalGzipBytes: number;
  readonly firstPage: {
    readonly gzipBytes: number;
    readonly chunks: readonly string[];
    readonly largestModules: readonly ModuleEntry[];
    readonly largestPackages: readonly PackageEntry[];
  };
  readonly chunks: readonly ChunkSummary[];
}

const defaultTopCount = 20;
const packagePattern = /node_modules\/((?:@[^/]+\/)?[^/]+)\//g;

function largestFirst<T extends { bytes: number }>(label: (item: T) => string) {
  return (a: T, b: T): number => b.bytes - a.bytes || label(a).localeCompare(label(b));
}

export function packageOf(moduleId: string): string {
  const matches = [...moduleId.replaceAll("\\", "/").matchAll(packagePattern)];
  return matches.at(-1)?.[1] ?? "application";
}

export function firstPageFileNames(chunks: readonly ChunkInput[]): Set<string> {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const reached = new Set<string>();
  const pending = chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName);
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (reached.has(name) || !byName.has(name)) continue;
    reached.add(name);
    pending.push(...(byName.get(name)?.imports ?? []));
  }
  return reached;
}

export function summarizeBundle(
  chunks: readonly ChunkInput[],
  topCount = defaultTopCount,
): BundleSummary {
  const initial = firstPageFileNames(chunks);
  const summaries: ChunkSummary[] = chunks
    .map((chunk) => ({
      fileName: chunk.fileName,
      firstPage: initial.has(chunk.fileName),
      bytes: Buffer.byteLength(chunk.code),
      gzipBytes: gzipSync(chunk.code).length,
      modules: Object.entries(chunk.modules)
        .map(([id, bytes]) => ({ id, bytes }))
        .sort(largestFirst((entry) => entry.id)),
    }))
    .sort((a, b) => b.gzipBytes - a.gzipBytes || a.fileName.localeCompare(b.fileName));
  const firstPageChunks = summaries.filter((chunk) => chunk.firstPage);
  const moduleBytes = new Map<string, number>();
  const packageBytes = new Map<string, number>();
  for (const chunk of firstPageChunks) {
    for (const { id, bytes } of chunk.modules) {
      moduleBytes.set(id, (moduleBytes.get(id) ?? 0) + bytes);
      const name = packageOf(id);
      packageBytes.set(name, (packageBytes.get(name) ?? 0) + bytes);
    }
  }
  return {
    totalGzipBytes: summaries.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
    firstPage: {
      gzipBytes: firstPageChunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
      chunks: firstPageChunks.map((chunk) => chunk.fileName),
      largestModules: [...moduleBytes]
        .map(([id, bytes]) => ({ id, bytes }))
        .sort(largestFirst((entry) => entry.id))
        .slice(0, topCount),
      largestPackages: [...packageBytes]
        .map(([name, bytes]) => ({ name, bytes }))
        .sort(largestFirst((entry) => entry.name))
        .slice(0, topCount),
    },
    chunks: summaries,
  };
}

export function bundleSummaryJson(root: string, outFile: string): Plugin {
  return {
    name: "parfocal:bundle-summary",
    apply: "build",
    async generateBundle(_options, bundle) {
      const chunks: ChunkInput[] = [];
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        const modules: Record<string, number> = {};
        for (const [id, info] of Object.entries(output.modules)) {
          if (id.startsWith("\0")) continue;
          modules[relative(root, id)] = info.renderedLength;
        }
        chunks.push({
          fileName: output.fileName,
          code: output.code,
          isEntry: output.isEntry,
          imports: output.imports,
          modules,
        });
      }
      await mkdir(dirname(outFile), { recursive: true });
      await writeFile(outFile, `${JSON.stringify(summarizeBundle(chunks), null, 2)}\n`);
    },
  };
}
