import type { Tier } from "@parfocal/ui/components/viewer-tools";
import type { OutlineTier } from "./prompt-fallback.ts";

export const graphBytes = {
  encoderQ4: 72_564_336,
  encoderUint8: 100_742_890,
  decoder: 16_495_823,
  windowDecoder: 16_496_090,
  largeDecoder: 16_495_861,
  largeWindowDecoder: 16_496_126,
} as const;

export const tierNames: Record<OutlineTier, string> = { best: "Best", good: "Good", fast: "Fast" };

export function tierOfName(name: string): OutlineTier | null {
  const found = (Object.keys(tierNames) as OutlineTier[]).find((tier) => tierNames[tier] === name);
  return found ?? null;
}

export function browserDownloadBytes(gpu: boolean): number {
  const encoder = gpu ? graphBytes.encoderQ4 : graphBytes.encoderUint8;
  return encoder + graphBytes.decoder + graphBytes.windowDecoder;
}

export function serverDecoderBytes(): number {
  return graphBytes.largeDecoder + graphBytes.largeWindowDecoder;
}

export function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export function usesServerEmbeddings(tier: OutlineTier): boolean {
  return tier === "best";
}

export function startingTier(saved: OutlineTier | undefined): OutlineTier {
  return saved === undefined || usesServerEmbeddings(saved) ? "good" : saved;
}

export function shownTier(tier: OutlineTier): OutlineTier {
  return tier === "fast" ? "good" : tier;
}

export function oneClickTiers(gpu: boolean): Tier[] {
  const browser = megabytes(browserDownloadBytes(gpu));
  const where = gpu ? "on the graphics card" : "on the processor";
  return [
    {
      name: tierNames.best,
      description:
        "The most accurate outlines. The Parfocal server reads the slide, your clicks are answered here. While the server starts or does not answer, Good outlines the click.",
      model: `PathoSAM ViT-L · on the Parfocal server, else ViT-B on this computer · ${megabytes(serverDecoderBytes())} and up to ${browser}`,
      speed: 1,
      colour: "var(--ok)",
    },
    {
      name: tierNames.good,
      description: "Runs on this computer, also offline.",
      model: `PathoSAM ViT-B · on this computer, ${where} · ${browser}, downloaded once`,
      speed: 2,
      colour: "var(--accent)",
    },
  ];
}
