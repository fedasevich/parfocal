import { readFileSync } from "node:fs";
import type { RemoteFixture } from "@parfocal/test-fixtures";
import {
  graphRunsOn,
  type SamGraph,
  type SamProvider,
  samGraphs,
  samVariant,
} from "../src/index.ts";

export type ParityFile = { file: string; sha256: string; bytes: number };
export type ParityFiles = { models: ParityFile[]; dataset: ParityFile[] };
export type ParityDownload = { fixture: RemoteFixture; key: string; into: "models" | "dataset" };

export const parityPrefix = "sam-parity";
export const parityFilesPath = new URL("./parity-files.json", import.meta.url);

const aisDecoders = [
  samGraphs.aisDecoder,
  samGraphs.aisDecoderInt8Weights,
  samGraphs.aisDecoderUint8,
] as const;

export function parityAisDecoders(provider: SamProvider): SamGraph[] {
  return aisDecoders.filter((graph) => graphRunsOn(graph, provider));
}

export function parityGraphs(provider: SamProvider): SamGraph[] {
  const variant = samVariant(provider);
  return [variant.encoder, variant.decoder, ...parityAisDecoders(provider)];
}

export function loadParityFiles(path: URL = parityFilesPath): ParityFiles {
  return JSON.parse(readFileSync(path, "utf8")) as ParityFiles;
}

export function parityDownloads(
  files: ParityFiles,
  providers: readonly SamProvider[],
  urlFor: (key: string) => string,
): ParityDownload[] {
  const wanted = new Set(providers.flatMap(parityGraphs));
  const missing = [...wanted].filter((graph) => !files.models.some((m) => m.file === graph));
  if (missing.length > 0) throw new Error(`parity-files.json lacks ${missing.join(", ")}`);
  const download = (into: ParityDownload["into"], dir: string) => (entry: ParityFile) => {
    const key = `${parityPrefix}/${dir}/${entry.file}`;
    return { key, into, fixture: { ...entry, url: urlFor(key), groups: [] } };
  };
  return [
    ...files.models.filter((m) => wanted.has(m.file as SamGraph)).map(download("models", "onnx")),
    ...files.dataset.map(download("dataset", "dataset")),
  ];
}
