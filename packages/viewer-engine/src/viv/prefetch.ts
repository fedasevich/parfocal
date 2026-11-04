import type { Camera, Viewport } from "../camera/camera.ts";
import {
  createMotionPredictor,
  type MotionPredictor,
  type MotionVector,
} from "../camera/motion-predictor.ts";
import type { PlannedRegion, VirtualLevel, VivRegion } from "./viv-levels.ts";
import { regionKey } from "./viv-levels.ts";

export const maxPrefetchTiles = 24;

const sweepSteps = 4;

export interface PrefetchTarget {
  prefetch(region: VivRegion, centre: { x: number; y: number }): boolean;
  dropPrefetch(keep?: ReadonlySet<string>): number;
}

export interface PrefetchLevels {
  readonly ladder: readonly VirtualLevel[];
  readonly tileSize: number;
  readonly regionFor: (level: number, x: number, y: number) => PlannedRegion | null;
}

export interface PrefetcherOptions {
  readonly levels: PrefetchLevels;
  readonly target: PrefetchTarget;
  readonly viewport: () => Viewport | null;
  readonly now: () => number;
  readonly predictor?: MotionPredictor;
  readonly enabled?: boolean;
  readonly maxTiles?: number;
}

export interface PrefetchPlan {
  readonly level: number;
  readonly tiles: readonly (readonly [number, number])[];
}

export interface Prefetcher {
  update(camera: Camera): PrefetchPlan | null;
  setEnabled(enabled: boolean): void;
  enabled(): boolean;
  vector(): MotionVector | null;
  lastPlan(): PrefetchPlan | null;
  reset(): void;
}

export function tileLevelForZoom(zoom: number, levelCount: number): number {
  return Math.min(levelCount - 1, Math.max(0, -Math.ceil(zoom)));
}

interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function viewRect(x: number, y: number, zoom: number, viewport: Viewport): Rect {
  const halfWidth = viewport.width / 2 ** zoom / 2;
  const halfHeight = viewport.height / 2 ** zoom / 2;
  return { left: x - halfWidth, top: y - halfHeight, right: x + halfWidth, bottom: y + halfHeight };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

export function predictedTiles(
  levels: PrefetchLevels,
  camera: Camera,
  target: { readonly x: number; readonly y: number },
  viewport: Viewport,
  maxTiles: number,
): PrefetchPlan | null {
  const level = tileLevelForZoom(camera.zoom, levels.ladder.length);
  const virtual = levels.ladder[level];
  if (virtual === undefined) return null;
  const span = levels.tileSize * virtual.downsample;
  const now = viewRect(camera.x, camera.y, camera.zoom, viewport);
  const steps: Rect[] = [];
  for (let step = 1; step <= sweepSteps; step++) {
    const along = step / sweepSteps;
    steps.push(
      viewRect(
        camera.x + (target.x - camera.x) * along,
        camera.y + (target.y - camera.y) * along,
        camera.zoom,
        viewport,
      ),
    );
  }
  const columns = Math.ceil(virtual.width / levels.tileSize);
  const rows = Math.ceil(virtual.height / levels.tileSize);
  const left = Math.max(0, Math.floor(Math.min(...steps.map((r) => r.left)) / span));
  const right = Math.min(columns - 1, Math.floor(Math.max(...steps.map((r) => r.right)) / span));
  const top = Math.max(0, Math.floor(Math.min(...steps.map((r) => r.top)) / span));
  const bottom = Math.min(rows - 1, Math.floor(Math.max(...steps.map((r) => r.bottom)) / span));
  const found: { tile: readonly [number, number]; distance: number }[] = [];
  for (let row = top; row <= bottom; row++) {
    for (let column = left; column <= right; column++) {
      const tile: Rect = {
        left: column * span,
        top: row * span,
        right: (column + 1) * span,
        bottom: (row + 1) * span,
      };
      if (intersects(tile, now)) continue;
      if (!steps.some((step) => intersects(tile, step))) continue;
      const distance = Math.hypot(
        (tile.left + tile.right) / 2 - camera.x,
        (tile.top + tile.bottom) / 2 - camera.y,
      );
      found.push({ tile: [column, row], distance });
    }
  }
  found.sort((a, b) => a.distance - b.distance);
  return { level, tiles: found.slice(0, maxTiles).map((entry) => entry.tile) };
}

export function createPrefetcher(options: PrefetcherOptions): Prefetcher {
  const predictor = options.predictor ?? createMotionPredictor();
  const maxTiles = options.maxTiles ?? maxPrefetchTiles;
  let on = options.enabled ?? true;
  let plan: PrefetchPlan | null = null;

  const clear = () => {
    plan = null;
    options.target.dropPrefetch();
  };

  return {
    update(camera) {
      predictor.sample(options.now(), camera);
      const viewport = options.viewport();
      if (!on || viewport === null || viewport.width <= 0 || viewport.height <= 0) {
        if (plan !== null) clear();
        return null;
      }
      const prediction = predictor.predict(viewport);
      if (prediction === null) {
        if (plan !== null) clear();
        return null;
      }
      const next = predictedTiles(options.levels, camera, prediction.target, viewport, maxTiles);
      if (next === null) {
        if (plan !== null) clear();
        return null;
      }
      const keep = new Set<string>();
      const planned: { region: VivRegion; centre: { x: number; y: number } }[] = [];
      for (const [column, row] of next.tiles) {
        const found = options.levels.regionFor(next.level, column, row);
        if (found === null) continue;
        keep.add(regionKey(found.region));
        planned.push(found);
      }
      options.target.dropPrefetch(keep);
      for (const { region, centre } of planned) options.target.prefetch(region, centre);
      plan = next;
      return next;
    },
    setEnabled(enabled) {
      if (enabled === on) return;
      on = enabled;
      if (!on) {
        predictor.reset();
        clear();
      }
    },
    enabled: () => on,
    vector: () => (on ? predictor.vector() : null),
    lastPlan: () => plan,
    reset() {
      predictor.reset();
      if (plan !== null) clear();
    },
  };
}
