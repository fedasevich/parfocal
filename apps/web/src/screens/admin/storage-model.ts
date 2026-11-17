import type { StorageSource, StorageUsage } from "@parfocal/api-client";

export type SpacePart = { kind: string; label: string; tb: number; colour: string };

export type Fullness = "empty" | "roomy" | "nearly-full" | "full";

const TERABYTE = 1e12;
const GIGABYTE = 1e9;
const MEGABYTE = 1e6;
export const NEARLY_FULL_SHARE = 0.9;

const kindColours: Record<string, string> = {
  "copied-slides": "var(--st-1)",
  "tile-cache": "var(--st-2)",
  results: "var(--st-3)",
};
const spareColours = ["var(--st-1)", "var(--st-2)", "var(--st-3)"];

export const colourOf = (kind: string, index: number) =>
  kindColours[kind] ?? spareColours[index % spareColours.length] ?? "var(--st-1)";

export const spaceParts = (usage: StorageUsage): SpacePart[] =>
  usage.parts.map((part, index) => ({
    kind: part.kind,
    label: part.label,
    tb: part.bytes / TERABYTE,
    colour: colourOf(part.kind, index),
  }));

export const barTotalTb = (usage: StorageUsage): number =>
  usage.capacity_tb ?? usage.total_bytes / TERABYTE;

export function fullness(usage: StorageUsage): Fullness {
  if (usage.total_bytes === 0) return "empty";
  if (usage.capacity_tb === null || usage.capacity_tb === 0) return "roomy";
  const share = usage.total_bytes / (usage.capacity_tb * TERABYTE);
  if (share >= 1) return "full";
  return share >= NEARLY_FULL_SHARE ? "nearly-full" : "roomy";
}

export const projectShare = (bytes: number, usage: StorageUsage): number =>
  usage.total_bytes === 0 ? 0 : Math.min(100, (100 * bytes) / usage.total_bytes);

const oneDecimal = (value: number) => `${+value.toFixed(1)}`;

export function sizeText(bytes: number): string {
  if (bytes >= TERABYTE) return `${oneDecimal(bytes / TERABYTE)} TB`;
  if (bytes >= GIGABYTE) return `${oneDecimal(bytes / GIGABYTE)} GB`;
  if (bytes >= MEGABYTE) return `${Math.round(bytes / MEGABYTE)} MB`;
  return bytes === 0 ? "0 GB" : "Under 1 MB";
}

export type SourceState = { tone: "ok" | "warn" | "neutral"; text: string };

export function sourceState(source: StorageSource): SourceState {
  if (source.health === "expiring")
    return { tone: "warn", text: `Key expires in ${source.expires_in_days ?? 0} days` };
  if (source.health === "unreachable") return { tone: "warn", text: "Not answering" };
  if (source.health === "unused") return { tone: "neutral", text: "No slides read in place" };
  return {
    tone: "ok",
    text:
      source.first_tile_ms === null
        ? `Answering · ${source.slides_in_place} slides`
        : `Answering · ${source.first_tile_ms} ms`,
  };
}
