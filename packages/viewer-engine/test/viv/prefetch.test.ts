import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPrefetcher,
  maxPrefetchTiles,
  type PlannedRegion,
  tileLevelForZoom,
  virtualLadder,
} from "../../src/viv/index.ts";
import { regionKey, type VivRegion } from "../../src/viv/viv-levels.ts";

const tileSize = 256;
const viewport = { width: 1024, height: 512 };
const ladder = virtualLadder(
  [{ downsample: 1, width: 40_960, height: 20_480, tileWidth: 256, tileHeight: 256 }],
  tileSize,
);

const levels = {
  ladder,
  tileSize,
  regionFor(level: number, x: number, y: number): PlannedRegion | null {
    const virtual = ladder[level];
    if (virtual === undefined) return null;
    if (x < 0 || y < 0 || x * tileSize >= virtual.width || y * tileSize >= virtual.height) {
      return null;
    }
    const x0 = x * tileSize;
    const y0 = y * tileSize;
    return {
      region: {
        backing: 0,
        residual: virtual.downsample,
        window: [x0 * virtual.downsample, y0 * virtual.downsample, 0, 0],
        width: tileSize,
        height: tileSize,
      },
      centre: {
        x: (x0 + tileSize / 2) * virtual.downsample,
        y: (y0 + tileSize / 2) * virtual.downsample,
      },
    };
  },
};

function fakeTarget() {
  const asked: { key: string; region: VivRegion; at: number }[] = [];
  const queued = new Set<string>();
  let clock = 0;
  return {
    asked,
    queued,
    tick: (to: number) => {
      clock = to;
    },
    prefetch(region: VivRegion) {
      const key = regionKey(region);
      if (queued.has(key)) return false;
      queued.add(key);
      asked.push({ key, region, at: clock });
      return true;
    },
    dropPrefetch(keep?: ReadonlySet<string>) {
      let dropped = 0;
      for (const key of [...queued]) {
        if (keep?.has(key)) continue;
        queued.delete(key);
        dropped++;
      }
      return dropped;
    },
  };
}

function visibleTiles(x: number, y: number, zoom: number): Set<string> {
  const scale = 2 ** zoom;
  const left = x - viewport.width / scale / 2;
  const right = x + viewport.width / scale / 2;
  const top = y - viewport.height / scale / 2;
  const bottom = y + viewport.height / scale / 2;
  const found = new Set<string>();
  for (let row = Math.floor(top / tileSize); row <= Math.floor((bottom - 1e-9) / tileSize); row++) {
    for (
      let column = Math.floor(left / tileSize);
      column <= Math.floor((right - 1e-9) / tileSize);
      column++
    ) {
      const planned = levels.regionFor(0, column, row);
      if (planned) found.add(regionKey(planned.region));
    }
  }
  return found;
}

function scripted(path: readonly (readonly [number, number])[], step = 16, enabled = true) {
  const target = fakeTarget();
  let clock = 0;
  const prefetcher = createPrefetcher({
    levels,
    target,
    viewport: () => viewport,
    now: () => clock,
    enabled,
  });
  const seen = new Set<string>();
  const late: string[] = [];
  path.forEach(([x, y], index) => {
    clock = index * step;
    target.tick(clock);
    for (const key of visibleTiles(x, y, 0)) {
      if (!seen.has(key) && index > 4) {
        const asked = target.asked.some((entry) => entry.key === key);
        if (!asked) late.push(key);
      }
      seen.add(key);
    }
    prefetcher.update({ x, y, zoom: 0 });
  });
  return { target, prefetcher, late };
}

const straight = Array.from({ length: 60 }, (_, index) => [4000 + index * 20, 5000] as const);

describe("the zoom to level rule", () => {
  it("matches the tile layer of deck.gl for an orthographic view", () => {
    assert.equal(tileLevelForZoom(0, 8), 0);
    assert.equal(tileLevelForZoom(-1, 8), 1);
    assert.equal(tileLevelForZoom(-1.2, 8), 1);
    assert.equal(tileLevelForZoom(-1.8, 8), 1);
    assert.equal(tileLevelForZoom(-20, 8), 7);
    assert.equal(tileLevelForZoom(2, 8), 0);
  });
});

describe("prefetching on a scripted pan", () => {
  it("requests the tiles of a straight pan before they enter the view", () => {
    const { target, late } = scripted(straight);
    assert.ok(target.asked.length > 0);
    assert.deepEqual(late, []);
  });

  it("asks only for tiles outside the current view, at most the cap", () => {
    const { target, prefetcher } = scripted(straight);
    const last = straight[straight.length - 1];
    assert.ok(last);
    const now = visibleTiles(last[0], last[1], 0);
    for (const key of target.queued) assert.equal(now.has(key), false);
    assert.ok((prefetcher.lastPlan()?.tiles.length ?? 0) <= maxPrefetchTiles);
    assert.ok((prefetcher.lastPlan()?.tiles.length ?? 0) > 0);
  });

  it("reaches no further than 1.25 viewports ahead", () => {
    const fast = Array.from({ length: 30 }, (_, index) => [2000 + index * 200, 5000] as const);
    const { prefetcher } = scripted(fast);
    const last = fast[fast.length - 1];
    const plan = prefetcher.lastPlan();
    assert.ok(last && plan);
    const farthest = Math.max(...plan.tiles.map(([column]) => (column + 1) * tileSize));
    assert.ok(farthest <= last[0] + viewport.width / 2 + 1.25 * viewport.width + tileSize);
  });

  it("prefetches nothing on a zig-zag pan", () => {
    const zigzag = Array.from(
      { length: 60 },
      (_, index) => [4000 + index * 3, 5000 + (index % 2 === 0 ? 0 : 300)] as const,
    );
    const { target } = scripted(zigzag);
    assert.equal(target.asked.length, 0);
  });

  it("drops the queued tiles when the pan turns", () => {
    const turn = [
      ...straight,
      ...Array.from({ length: 40 }, (_, index) => [5180 - index * 20, 5000 + index * 20] as const),
    ];
    const { target } = scripted(turn.slice(0, 60));
    assert.ok(target.queued.size > 0);
    const after = scripted(turn);
    const last = turn[turn.length - 1];
    assert.ok(last);
    for (const key of after.target.queued) {
      assert.equal(visibleTiles(last[0], last[1], 0).has(key), false);
    }
  });

  it("does nothing while turned off, and clears the queue when turned off", () => {
    const off = scripted(straight, 16, false);
    assert.equal(off.target.asked.length, 0);
    assert.equal(off.prefetcher.vector(), null);
    const on = scripted(straight);
    assert.ok(on.target.queued.size > 0);
    on.prefetcher.setEnabled(false);
    assert.equal(on.target.queued.size, 0);
  });
});
