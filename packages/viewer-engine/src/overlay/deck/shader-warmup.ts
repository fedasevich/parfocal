import type { Layer } from "@deck.gl/core";
import { polygonBatchFromRings } from "../batches.ts";
import { lodMinShapes } from "../lod.ts";
import { createVectorOverlay } from "../overlay.ts";
import { createOverlayLayerBuilder } from "./overlay-layers.ts";

export const warmupOrigin = -1_000_000;
const warmupSide = 8;
const warmupColumns = 32;
const warmupShapes = lodMinShapes + 100;

const tiers = [
  { name: "outlines", pixelsPerUnit: 2 },
  { name: "dots", pixelsPerUnit: 0.4 },
  { name: "density", pixelsPerUnit: 0.1 },
] as const;

function warmupBatch() {
  const rings = [];
  for (let shape = 0; shape < warmupShapes; shape++) {
    const x = warmupOrigin + (shape % warmupColumns) * warmupSide * 2;
    const y = warmupOrigin + Math.floor(shape / warmupColumns) * warmupSide * 2;
    rings.push({
      ring: [x, y, x + warmupSide, y, x + warmupSide, y + warmupSide, x, y + warmupSide],
      color: [0, 0, 0, 0] as const,
    });
  }
  return polygonBatchFromRings(rings);
}

export interface GpuDeviceInfo {
  readonly gpuType?: string;
  readonly renderer?: string;
}

const softwareRenderers = /swiftshader|llvmpipe|softpipe|software/i;

export function deviceInfoOf(deck: unknown): GpuDeviceInfo | null {
  const device = (deck as { device?: { info?: GpuDeviceInfo } | null }).device;
  return device?.info ?? null;
}

export function warmupPaysOff(info: GpuDeviceInfo | null): boolean {
  if (info === null) return true;
  if (info.gpuType === "cpu") return false;
  return !softwareRenderers.test(info.renderer ?? "");
}

export function nucleiWarmupLayers(): Layer[] {
  const polygons = warmupBatch();
  const span = warmupSide * 2 * warmupColumns;
  const view = [warmupOrigin, warmupOrigin, warmupOrigin + span, warmupOrigin + span] as const;
  return tiers.flatMap((tier) => {
    const overlay = createVectorOverlay({
      id: `shader-warmup:${tier.name}`,
      kind: "nuclei",
      shapes: { polygons },
    });
    return createOverlayLayerBuilder().build([overlay], tier.pixelsPerUnit, view);
  });
}
