import { bestMask, fittedLogits, type SamClient, type SamFrame } from "@parfocal/viewer-engine";
import { simplifyRing, traceMask } from "./contour-trace.ts";
import {
  type BatchDecoder,
  type PromptMask,
  type PromptPassOptions,
  type PromptQuality,
  promptPass,
  promptPassOptionsFor,
  stabilityScore,
} from "./prompt-pass.ts";
import type { RegionNucleus } from "./region-pass.ts";
import { SCALE_PRESETS } from "./scale-presets.ts";

export type OutlineTier = "best" | "good" | "fast";

export function qualityForTier(tier: OutlineTier): PromptQuality {
  return tier === "best" ? "best" : "fast";
}

export type PromptSam = Pick<SamClient, "prompt">;

export interface FallbackTile {
  readonly id: string;
  readonly rgb: Uint8Array;
  readonly frame: SamFrame;
  readonly signal?: AbortSignal;
}

export type RegionFallback = (tile: FallbackTile) => Promise<RegionNucleus[]>;

export function samBatchDecoder(sam: PromptSam, id: string, frame: SamFrame): BatchDecoder {
  const { patch, scale, fittedWidth, fittedHeight } = frame;
  return async (seeds) => {
    const results: PromptMask[] = [];
    for (const [x, y] of seeds) {
      const outcome = await sam.prompt(id, {
        points: [{ x: (x + 0.5) * scale, y: (y + 0.5) * scale, positive: true }],
      });
      if (outcome.status !== "answer") {
        results.push({ mask: null, score: 0, stability: 0 });
        continue;
      }
      const best = bestMask(outcome.outputs);
      const logits = fittedLogits(best.logits, frame);
      const mask = new Uint8Array(patch.width * patch.height);
      const patchLogits = new Float32Array(mask.length);
      for (let py = 0; py < patch.height; py++) {
        const my = Math.min(fittedHeight - 1, Math.floor((py + 0.5) * scale));
        for (let px = 0; px < patch.width; px++) {
          const mx = Math.min(fittedWidth - 1, Math.floor((px + 0.5) * scale));
          const value = logits[my * fittedWidth + mx] ?? 0;
          patchLogits[py * patch.width + px] = value;
          if (value > 0) mask[py * patch.width + px] = 1;
        }
      }
      results.push({
        mask,
        score: best.score,
        stability: stabilityScore(logits),
        logits: patchLogits,
      });
    }
    return results;
  };
}

export function promptFallback(sam: PromptSam, options: PromptPassOptions): RegionFallback {
  return async ({ id, rgb, frame, signal }) => {
    const { patch } = frame;
    const image = { rgb, width: patch.width, height: patch.height };
    const outcome = await promptPass(image, samBatchDecoder(sam, id, frame), options, signal);
    const nuclei: RegionNucleus[] = [];
    for (const nucleus of outcome.nuclei) {
      const traced = traceMask(nucleus.mask, patch.width, patch.height);
      if (traced === null) continue;
      const local = simplifyRing(traced, 0.25);
      const ring = new Float32Array(local.length);
      for (let i = 0; i < ring.length; i += 2) {
        ring[i] = (patch.x + (local[i] ?? 0) + 0.5) * patch.downsample;
        ring[i + 1] = (patch.y + (local[i + 1] ?? 0) + 0.5) * patch.downsample;
      }
      let sumX = 0;
      let sumY = 0;
      for (let p = 0; p < nucleus.mask.length; p++) {
        if (!nucleus.mask[p]) continue;
        sumX += p % patch.width;
        sumY += Math.floor(p / patch.width);
      }
      nuclei.push({
        ring,
        centroid: {
          x: (patch.x + sumX / nucleus.area + 0.5) * patch.downsample,
          y: (patch.y + sumY / nucleus.area + 0.5) * patch.downsample,
        },
        score: nucleus.score,
      });
    }
    return nuclei;
  };
}

export function autoFallback(sam: PromptSam, tier: OutlineTier): RegionFallback {
  return promptFallback(
    sam,
    promptPassOptionsFor(SCALE_PRESETS.nuclei.micronsPerPixel, qualityForTier(tier)),
  );
}
