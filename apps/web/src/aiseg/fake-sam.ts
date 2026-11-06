import {
  type Patch,
  type SamClient,
  type SamOutputs,
  type SamPrompt,
  samImageSize,
  samMaskInputSize,
} from "@parfocal/viewer-engine";
import type { PresetPatchQuery } from "./patch-reader.ts";
import type { SmartReader } from "./smart-session.ts";

export const fakeDiscRadius = 40;
export const fakeNegativeRadius = 24;
export const fakePatchSize = 512;
export const fakeCandidates = 4;
export const fakeBestCandidate = 2;

export interface FakePromptRecord {
  readonly prompt: SamPrompt;
}

export interface FakeSam extends Pick<SamClient, "encode" | "prompt"> {
  readonly prompts: FakePromptRecord[];
  readonly encodes: string[];
}

function near(x: number, y: number, centre: { x: number; y: number }, radius: number): boolean {
  return Math.hypot(x - centre.x, y - centre.y) <= radius;
}

export function fakeOutputs(prompt: SamPrompt): SamOutputs {
  const side = samImageSize;
  const cells = side * side;
  const masks = new Float32Array(fakeCandidates * cells).fill(-4);
  const positives = prompt.points.filter((point) => point.positive);
  const negatives = prompt.points.filter((point) => !point.positive);
  const box = prompt.box ?? null;
  const offset = fakeBestCandidate * cells;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      let on =
        positives.some((point) => near(x + 0.5, y + 0.5, point, fakeDiscRadius)) ||
        (positives.length === 0 && box !== null);
      if (on && box !== null) {
        on = x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
      }
      if (on && negatives.some((point) => near(x + 0.5, y + 0.5, point, fakeNegativeRadius))) {
        on = false;
      }
      if (on) masks[offset + y * side + x] = 4;
    }
  }
  const lowSide = samMaskInputSize;
  const lowRes = new Float32Array(fakeCandidates * lowSide * lowSide).fill(-4);
  const ratio = side / lowSide;
  for (let y = 0; y < lowSide; y++) {
    for (let x = 0; x < lowSide; x++) {
      lowRes[fakeBestCandidate * lowSide * lowSide + y * lowSide + x] =
        masks[offset + Math.floor(y * ratio) * side + Math.floor(x * ratio)] ?? -4;
    }
  }
  return {
    masks: { dims: [1, fakeCandidates, side, side], data: masks },
    iou_predictions: { dims: [1, fakeCandidates], data: Float32Array.of(0.4, 0.5, 0.92, 0.6) },
    low_res_masks: { dims: [1, fakeCandidates, lowSide, lowSide], data: lowRes },
  };
}

export function createFakeSam(): FakeSam {
  const prompts: FakePromptRecord[] = [];
  const encodes: string[] = [];
  return {
    prompts,
    encodes,
    encode(id) {
      encodes.push(id);
      return Promise.resolve({ id, ms: 1, evicted: [] });
    },
    prompt(_id, prompt) {
      prompts.push({ prompt });
      return Promise.resolve({ status: "answer", outputs: fakeOutputs(prompt), ms: 1 });
    },
  };
}

export function fakePatch(
  slide: { readonly width: number; readonly height: number },
  query: PresetPatchQuery,
  size = fakePatchSize,
): Patch {
  const width = Math.min(size, slide.width);
  const height = Math.min(size, slide.height);
  const x = Math.max(0, Math.min(slide.width - width, Math.round(query.x - width / 2)));
  const y = Math.max(0, Math.min(slide.height - height, Math.round(query.y - height / 2)));
  return {
    key: `${x}:${y}:${width}`,
    level: 0,
    downsample: 1,
    x,
    y,
    width,
    height,
    absent: false,
    rgb: new Uint8Array(width * height * 3).fill(200),
  };
}

export function createFakeReader(slide: {
  readonly width: number;
  readonly height: number;
}): SmartReader {
  return {
    read(query) {
      return Promise.resolve({ patch: fakePatch(slide, query) });
    },
  };
}
