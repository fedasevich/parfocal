import {
  bestMask,
  type Patch,
  patchContains,
  type SamClient,
  type SamFrame,
  samFrame,
  samPixels,
  slideToModel,
} from "@parfocal/viewer-engine";
import type { PresetPatch, PresetPatchQuery } from "./patch-reader.ts";
import { plainFailure } from "./plain-message.ts";
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
  readonly queued: readonly SmartPress[];
  readonly requests: number;
}

export interface SmartSessionOptions {
  readonly slideId: string;
  readonly preset?: ScalePresetId;
  readonly reader: SmartReader;
  readonly sam: SmartSam;
  readonly onChange: (snapshot: SmartSnapshot) => void;
  readonly onHover?: (ring: Float32Array | null) => void;
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
  clearQueue(): void;
  prewarm(at: { readonly x: number; readonly y: number }): Promise<void>;
  pausePrewarm(): void;
  hover(at: { readonly x: number; readonly y: number }, extend?: boolean): Promise<void>;
  clearHover(): void;
  snapshot(): SmartSnapshot;
  reset(): void;
  close(): void;
}

interface Waiting {
  readonly press: SmartPress;
  readonly done: () => void;
}

interface Draft {
  prompts: SmartPrompts;
  patch: Patch | null;
  frame: SamFrame | null;
  logits: Float32Array | null;
  ring: Float32Array | null;
  confidence: number;
}

interface WarmPatch {
  readonly id: string;
  readonly patch: Patch;
  readonly frame: SamFrame;
}

interface Answer {
  readonly ring: Float32Array | null;
  readonly lowRes: Float32Array;
  readonly confidence: number;
}

interface HoverRequest {
  readonly at: { readonly x: number; readonly y: number };
  readonly extend: boolean;
}

export const answerCacheSize = 64;

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
  const warm = new Map<string, WarmPatch>();
  const coming = new Map<string, WarmPatch>();
  const answers = new Map<string, Answer>();
  let hoverTurn = 0;
  let hoverRunning: Promise<void> | null = null;
  let hoverLatest: HoverRequest | null = null;
  let hoverKey: string | null = null;
  let prewarmTurn = 0;
  let kept: SmartObject[] = [];
  let draft: Draft | null = null;
  let phase: SmartPhase = "idle";
  let message: string | null = null;
  let version = 0;
  let queue: Promise<void> = Promise.resolve();
  let waiting: Waiting[] = [];
  let running = 0;
  let requests = 0;
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
      queued: waiting.map((item) => item.press),
      requests,
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

  function forget(id: string) {
    embeddings.delete(id);
    warm.delete(id);
    for (const key of answers.keys()) {
      if (key.startsWith(`${id}|`)) answers.delete(key);
    }
  }

  function remember(key: string, answer: Answer) {
    answers.delete(key);
    answers.set(key, answer);
    const oldest = answers.keys().next();
    if (answers.size > answerCacheSize && !oldest.done) answers.delete(oldest.value);
  }

  function answerKey(entry: WarmPatch, prompts: SmartPrompts): string {
    const parts = prompts.points.map((point) => {
      const at = slideToModel(entry.frame, point);
      return `${point.positive ? "+" : "-"}${Math.floor(at.x)},${Math.floor(at.y)}`;
    });
    return `${entry.id}|${parts.join(";")}`;
  }

  function warmAt(point: { readonly x: number; readonly y: number }): WarmPatch | null {
    let found: WarmPatch | null = null;
    for (const entry of warm.values()) {
      if (patchContains(entry.patch, point)) found = entry;
    }
    return found;
  }

  function comingAt(point: { readonly x: number; readonly y: number }): WarmPatch | null {
    let found: WarmPatch | null = null;
    for (const entry of coming.values()) {
      if (patchContains(entry.patch, point)) found = entry;
    }
    return found;
  }

  function embed(patch: Patch, rgb: Uint8Array, frame: SamFrame): Promise<void> {
    const id = `${options.slideId}:${patch.key}`;
    const known = embeddings.get(id);
    if (known !== undefined) return known;
    coming.set(id, { id, patch, frame });
    const pending = options.sam
      .encode(id, samPixels(rgb, frame))
      .then(
        (done) => {
          for (const gone of done.evicted) forget(gone);
          if (embeddings.has(id)) warm.set(id, { id, patch, frame });
        },
        (error: unknown) => {
          forget(id);
          throw error;
        },
      )
      .finally(() => coming.delete(id));
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
      if (target.patch === null && target.prompts.box === null && target.logits === null) {
        const entry = warmAt(anchor);
        const known = entry === null ? undefined : answers.get(answerKey(entry, target.prompts));
        if (entry !== null && known !== undefined && target.prompts.points.length === 1) {
          target.patch = entry.patch;
          target.frame = entry.frame;
          target.logits = known.lowRes;
          target.ring = known.ring;
          target.confidence = known.confidence;
          settle(
            known.ring === null ? "failed" : "ready",
            known.ring === null ? "No outline found" : null,
          );
          return;
        }
      }
      const pending =
        target.patch === null && target.prompts.box === null && warmAt(anchor) === null
          ? comingAt(anchor)
          : null;
      if (pending !== null) {
        target.patch = pending.patch;
        target.frame = pending.frame;
      }
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
      requests += 1;
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
      settle("failed", plainFailure(error, "Smart select could not outline that"));
    }
  }

  async function previewAt(request: HoverRequest, turn: number): Promise<void> {
    const entry = warmAt(request.at);
    if (entry === null) {
      showHover(null, null);
      return;
    }
    const point = { x: request.at.x, y: request.at.y, positive: true };
    const extending =
      request.extend && draft !== null && draft.patch === entry.patch && draft.logits !== null;
    const prompts = withPoint(extending && draft !== null ? draft.prompts : emptyPrompts, point);
    const key = answerKey(entry, prompts);
    if (key === hoverKey) return;
    let answer = answers.get(key);
    if (answer === undefined) {
      const previous = extending && draft !== null ? draft.logits : null;
      const outcome = await options.sam.prompt(
        entry.id,
        modelPrompt(entry.frame, prompts, previous),
      );
      if (turn !== hoverTurn || closed || outcome.status === "stale") return;
      const best = bestMask(outcome.outputs);
      answer = {
        ring: maskToSlideRing(best, entry.frame, prompts),
        lowRes: best.lowRes,
        confidence: Math.max(0, Math.min(1, best.score)),
      };
      if (!extending) remember(key, answer);
    }
    showHover(answer.ring, key);
  }

  function dropHover() {
    hoverTurn += 1;
    hoverLatest = null;
    showHover(null, null);
  }

  function showHover(ring: Float32Array | null, key: string | null) {
    if (closed) return;
    const changed = hoverKey !== key;
    hoverKey = key;
    if (changed) options.onHover?.(ring);
  }

  async function drainHover(): Promise<void> {
    while (hoverLatest !== null && !closed) {
      const request = hoverLatest;
      hoverLatest = null;
      try {
        await previewAt(request, hoverTurn);
      } catch {
        showHover(null, null);
      }
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

  function applyPress(press: SmartPress): boolean {
    if (startsNewObject(press)) retire();
    else if (draft === null) return false;
    const target = draft ?? newDraft();
    if (press.kind === "box") {
      target.prompts = withBox(target.prompts, normalisedBox(press.from, press.to));
    } else {
      const point = { x: press.at.x, y: press.at.y, positive: press.positive };
      if (target.patch !== null && !patchContains(target.patch, point)) {
        settle("outside", "Outside the area being refined");
        return false;
      }
      target.prompts = withPoint(target.prompts, point);
    }
    draft = target;
    return true;
  }

  function schedule(target: Draft, mine: number): Promise<void> {
    running += 1;
    return enqueue(() => (mine === version ? solve(target, mine) : Promise.resolve())).finally(
      () => {
        running -= 1;
        if (running === 0) flush();
      },
    );
  }

  function begin(presses: readonly SmartPress[]): Promise<void> | null {
    let changed = false;
    for (const press of presses) {
      if (applyPress(press)) changed = true;
    }
    if (!changed || draft === null) return null;
    version += 1;
    publish();
    return schedule(draft, version);
  }

  function takeBatch(): Waiting[] {
    const head = waiting[0];
    if (head === undefined) return [];
    let count = 1;
    if (!startsNewObject(head.press)) {
      const next = waiting.findIndex((item, index) => index > 0 && startsNewObject(item.press));
      count = next === -1 ? waiting.length : next;
    }
    const batch = waiting.slice(0, count);
    waiting = waiting.slice(count);
    return batch;
  }

  function flush() {
    while (!closed && running === 0 && waiting.length > 0) {
      const batch = takeBatch();
      const solving = begin(batch.map((item) => item.press));
      if (solving === null) {
        publish();
        for (const item of batch) item.done();
        continue;
      }
      void solving.then(() => {
        for (const item of batch) item.done();
      });
    }
  }

  function dropQueue() {
    const gone = waiting;
    waiting = [];
    for (const item of gone) item.done();
    return gone.length > 0;
  }

  return {
    press(press) {
      if (closed) return Promise.resolve();
      dropHover();
      if (running > 0 || waiting.length > 0) {
        return new Promise<void>((resolve) => {
          waiting = [...waiting, { press, done: resolve }];
          publish();
        });
      }
      return begin([press]) ?? Promise.resolve();
    },

    removeLast() {
      if (closed) return Promise.resolve();
      const last = waiting.at(-1);
      if (last !== undefined) {
        waiting = waiting.slice(0, -1);
        last.done();
        publish();
        return Promise.resolve();
      }
      if (draft === null) return Promise.resolve();
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
      return schedule(target, mine);
    },

    clearQueue() {
      if (closed) return;
      if (dropQueue()) publish();
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

    hover(at, extend = false) {
      if (closed || phase === "thinking") return Promise.resolve();
      hoverLatest = { at, extend };
      if (hoverRunning === null) {
        hoverRunning = drainHover().finally(() => {
          hoverRunning = null;
        });
      }
      return hoverRunning;
    },

    clearHover: dropHover,

    snapshot,

    reset() {
      dropHover();
      dropQueue();
      version += 1;
      kept = [];
      draft = null;
      phase = "idle";
      message = null;
      publish();
    },

    close() {
      dropQueue();
      hoverTurn += 1;
      hoverLatest = null;
      version += 1;
      closed = true;
      stopPrewarm();
    },
  };
}
