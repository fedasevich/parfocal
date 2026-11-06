import {
  bestMask,
  type Patch,
  patchContains,
  type SamClient,
  type SamFrame,
  samFrame,
  samPixels,
} from "@parfocal/viewer-engine";
import type { PresetPatch, PresetPatchQuery } from "./patch-reader.ts";
import type { ScalePresetId } from "./scale-presets.ts";
import {
  anchorOf,
  emptyPrompts,
  isEmpty,
  maskToSlideRing,
  modelPrompt,
  normalisedBox,
  type SmartPrompts,
  withBox,
  withoutLast,
  withPoint,
} from "./smart-select.ts";

export interface SmartReader {
  read(query: PresetPatchQuery, signal?: AbortSignal): Promise<Pick<PresetPatch, "patch">>;
}

export type SmartSam = Pick<SamClient, "encode" | "prompt">;

export interface SmartObject {
  readonly prompts: SmartPrompts;
  readonly ring: Float32Array | null;
  readonly confidence: number;
}

export type SmartPhase = "idle" | "thinking" | "ready" | "outside" | "failed";

export interface SmartSnapshot {
  readonly kept: readonly SmartObject[];
  readonly live: SmartObject | null;
  readonly phase: SmartPhase;
  readonly message: string | null;
}

export interface SmartSessionOptions {
  readonly slideId: string;
  readonly preset?: ScalePresetId;
  readonly reader: SmartReader;
  readonly sam: SmartSam;
  readonly onChange: (snapshot: SmartSnapshot) => void;
}

export type SmartPress =
  | {
      readonly kind: "point";
      readonly at: { readonly x: number; readonly y: number };
      readonly positive: boolean;
      readonly extend: boolean;
    }
  | {
      readonly kind: "box";
      readonly from: { readonly x: number; readonly y: number };
      readonly to: { readonly x: number; readonly y: number };
    };

export interface SmartSession {
  press(press: SmartPress): Promise<void>;
  removeLast(): Promise<void>;
  prewarm(at: { readonly x: number; readonly y: number }): Promise<void>;
  pausePrewarm(): void;
  snapshot(): SmartSnapshot;
  reset(): void;
  close(): void;
}

interface Draft {
  prompts: SmartPrompts;
  patch: Patch | null;
  frame: SamFrame | null;
  logits: Float32Array | null;
  ring: Float32Array | null;
  confidence: number;
}

function newDraft(): Draft {
  return {
    prompts: emptyPrompts,
    patch: null,
    frame: null,
    logits: null,
    ring: null,
    confidence: 0,
  };
}

export function createSmartSession(options: SmartSessionOptions): SmartSession {
  const preset = options.preset ?? "nuclei";
  const embeddings = new Map<string, Promise<void>>();
  let prewarmTurn = 0;
  let kept: SmartObject[] = [];
  let draft: Draft | null = null;
  let phase: SmartPhase = "idle";
  let message: string | null = null;
  let version = 0;
  let queue: Promise<void> = Promise.resolve();
  let closed = false;

  function objectOf(source: Draft): SmartObject {
    return { prompts: source.prompts, ring: source.ring, confidence: source.confidence };
  }

  function snapshot(): SmartSnapshot {
    return {
      kept: [...kept],
      live: draft === null ? null : objectOf(draft),
      phase,
      message,
    };
  }

  function publish() {
    if (!closed) options.onChange(snapshot());
  }

  function settle(next: SmartPhase, note: string | null = null) {
    phase = next;
    message = note;
    publish();
  }

  function retire() {
    if (draft !== null && draft.ring !== null) kept = [...kept, objectOf(draft)];
    draft = null;
  }

  function embed(patch: Patch, rgb: Uint8Array, frame: SamFrame): Promise<void> {
    const id = `${options.slideId}:${patch.key}`;
    const known = embeddings.get(id);
    if (known !== undefined) return known;
    const pending = options.sam.encode(id, samPixels(rgb, frame)).then(
      (done) => {
        for (const gone of done.evicted) embeddings.delete(gone);
      },
      (error: unknown) => {
        embeddings.delete(id);
        throw error;
      },
    );
    embeddings.set(id, pending);
    return pending;
  }

  function stopPrewarm() {
    prewarmTurn += 1;
  }

  async function solve(target: Draft, mine: number): Promise<void> {
    const anchor = anchorOf(target.prompts);
    if (anchor === null) {
      target.ring = null;
      settle("idle");
      return;
    }
    settle("thinking");
    try {
      if (target.patch === null) {
        const read = await options.reader.read({ preset, x: anchor.x, y: anchor.y });
        const { patch } = read;
        if (patch.absent || patch.rgb === null) {
          settle("failed", "This area has no pixels yet");
          return;
        }
        if (patch.width !== patch.height) {
          settle("failed", "This area is too small for smart select");
          return;
        }
        target.patch = patch;
        target.frame = samFrame(patch);
        if (mine !== version) return;
      }
      const { patch, frame } = target;
      if (patch === null || frame === null || patch.rgb === null) return;
      const id = `${options.slideId}:${patch.key}`;
      await embed(patch, patch.rgb, frame);
      if (mine !== version) return;
      const outcome = await options.sam.prompt(
        id,
        modelPrompt(frame, target.prompts, target.logits),
      );
      if (mine !== version || outcome.status === "stale") return;
      const best = bestMask(outcome.outputs);
      target.logits = best.lowRes;
      target.ring = maskToSlideRing(best, frame, target.prompts);
      target.confidence = Math.max(0, Math.min(1, best.score));
      settle(
        target.ring === null ? "failed" : "ready",
        target.ring === null ? "No outline found" : null,
      );
    } catch (error) {
      if (mine !== version) return;
      settle("failed", error instanceof Error ? error.message : "Smart select failed");
    }
  }

  function enqueue(job: () => Promise<void>): Promise<void> {
    const next = queue.then(job, job);
    queue = next.catch(() => undefined);
    return next;
  }

  function startsNewObject(press: SmartPress): boolean {
    if (press.kind === "box") return true;
    return press.positive && !press.extend;
  }

  return {
    press(press) {
      if (closed) return Promise.resolve();
      if (startsNewObject(press)) retire();
      else if (draft === null) return Promise.resolve();
      const target = draft ?? newDraft();
      if (press.kind === "box") {
        target.prompts = withBox(target.prompts, normalisedBox(press.from, press.to));
      } else {
        const point = { x: press.at.x, y: press.at.y, positive: press.positive };
        if (target.patch !== null && !patchContains(target.patch, point)) {
          settle("outside", "Outside the area being refined");
          return Promise.resolve();
        }
        target.prompts = withPoint(target.prompts, point);
      }
      draft = target;
      version += 1;
      const mine = version;
      publish();
      return enqueue(() => (mine === version ? solve(target, mine) : Promise.resolve()));
    },

    removeLast() {
      if (closed || draft === null) return Promise.resolve();
      const target = draft;
      target.prompts = withoutLast(target.prompts);
      target.logits = null;
      target.patch = null;
      target.frame = null;
      version += 1;
      const mine = version;
      if (isEmpty(target.prompts)) {
        draft = null;
        settle("idle");
        return Promise.resolve();
      }
      target.ring = null;
      publish();
      return enqueue(() => (mine === version ? solve(target, mine) : Promise.resolve()));
    },

    async prewarm(at) {
      if (closed) return;
      prewarmTurn += 1;
      const turn = prewarmTurn;
      try {
        const { patch } = await options.reader.read({ preset, x: at.x, y: at.y });
        if (turn !== prewarmTurn || closed) return;
        if (patch.absent || patch.rgb === null || patch.width !== patch.height) return;
        await embed(patch, patch.rgb, samFrame(patch));
      } catch {
        return;
      }
    },

    pausePrewarm: stopPrewarm,

    snapshot,

    reset() {
      version += 1;
      kept = [];
      draft = null;
      phase = "idle";
      message = null;
      publish();
    },

    close() {
      version += 1;
      closed = true;
      stopPrewarm();
    },
  };
}
