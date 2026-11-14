import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estimateRemainingMs,
  finishedTileMarks,
  type PolygonInput,
  polygonBatchFromRings,
  RebuildGate,
  type RunStatus,
  RunStream,
  type RunStreamSource,
  type SceneBlock,
  type StreamArea,
  StreamedScene,
  type StreamPage,
} from "../../src/index.ts";

const color = [200, 40, 40, 255] as const;

function square(x: number, y: number): PolygonInput {
  return { ring: [x, y, x + 4, y, x + 4, y + 4, x, y + 4], color };
}

function tile(unit: number, count: number): PolygonInput[] {
  return Array.from({ length: count }, (_, item) => square(unit * 100 + item * 5, 0));
}

class FakeClock {
  now = 0;
  read = () => this.now;
}

class FakeRun implements RunStreamSource {
  readonly tiles: PolygonInput[][];
  finished = 0;
  status: RunStatus = "running";
  cancels = 0;
  pageSize: number;
  perPoll: number;
  readonly clock: FakeClock;
  private seq = 0;
  private readonly areas: StreamArea[] = [];

  constructor(tiles: PolygonInput[][], clock: FakeClock, perPoll = 1, pageSize = 1000) {
    this.tiles = tiles;
    this.clock = clock;
    this.perPoll = perPoll;
    this.pageSize = pageSize;
  }

  advance(): void {
    if (this.status === "cancelling") {
      this.status = "cancelled";
      return;
    }
    if (this.status !== "running") return;
    for (let step = 0; step < this.perPoll && this.finished < this.tiles.length; step++) {
      const unit = this.finished;
      this.areas.push({
        seq: ++this.seq,
        stage: "detect",
        unit,
        x: unit * 100,
        y: 0,
        width: 100,
        height: 100,
        objects: this.tiles[unit]?.length ?? 0,
        doneAt: this.clock.now,
      });
      this.finished++;
    }
    if (this.finished === this.tiles.length) this.status = "done";
  }

  page(after: number): Promise<StreamPage> {
    const newer = this.areas.filter((area) => area.seq > after);
    const areas = newer.slice(0, this.pageSize);
    return Promise.resolve({
      status: this.status,
      areas,
      after: areas[areas.length - 1]?.seq ?? after,
      more: newer.length > areas.length,
      total: this.tiles.length,
    });
  }

  objects(area: StreamArea): Promise<readonly PolygonInput[]> {
    return Promise.resolve(this.tiles[area.unit] ?? []);
  }

  cancel(): Promise<void> {
    this.cancels++;
    if (this.status === "running") this.status = "cancelling";
    return Promise.resolve();
  }
}

function streamOf(
  run: FakeRun,
  scene: StreamedScene,
  extra: { onWait?: () => void; after?: number; slice?: number } = {},
) {
  const rebuilds: SceneBlock[][] = [];
  const statuses: { status: RunStatus; drawn: number }[] = [];
  const stream = new RunStream({
    lineage: "run-1",
    scene,
    source: run,
    gate: new RebuildGate({ now: run.clock.read }),
    ...(extra.after === undefined ? {} : { after: extra.after }),
    slice: extra.slice ?? 3,
    pollMs: 1000,
    yieldTask: () => Promise.resolve(),
    yieldFrame: () => Promise.resolve(),
    wait: (ms) => {
      run.clock.now += ms;
      extra.onWait?.();
      run.advance();
      return Promise.resolve();
    },
    onRebuild: (blocks) => {
      rebuilds.push([...blocks]);
      statuses.push({
        status: run.status,
        drawn: blocks.reduce((sum, block) => sum + block.batch.count, 0),
      });
    },
  });
  return { stream, rebuilds, statuses };
}

describe("RunStream", () => {
  it("draws objects before the run ends and ends equal to a scene built from scratch", async () => {
    const clock = new FakeClock();
    const tiles = [5, 0, 8, 2, 9, 4, 7, 1].map((count, unit) => tile(unit, count));
    const run = new FakeRun(tiles, clock);
    run.advance();
    const scene = new StreamedScene(6);
    const { stream, statuses } = streamOf(run, scene);
    const progress = await stream.start();

    assert.equal(progress.status, "done");
    assert.equal(progress.done, tiles.length);
    assert.equal(progress.share, 1);
    assert.equal(progress.remainingMs, 0);
    assert.ok(statuses.some((entry) => entry.status === "running" && entry.drawn > 0));
    const scratch = polygonBatchFromRings(tiles.flat());
    const merged = scene.merged();
    assert.deepEqual(merged.positions, scratch.positions);
    assert.deepEqual(merged.indices, scratch.indices);
    assert.deepEqual(merged.starts, scratch.starts);
    assert.equal(statuses.at(-1)?.drawn, scratch.count);
  });

  it("rebuilds at most every 3 s while the run goes on", async () => {
    const clock = new FakeClock();
    const tiles = Array.from({ length: 12 }, (_, unit) => tile(unit, 3));
    const run = new FakeRun(tiles, clock);
    run.advance();
    const times: number[] = [];
    const scene = new StreamedScene();
    const recorder = new RunStream({
      lineage: "run-1",
      scene,
      source: run,
      gate: new RebuildGate({ now: clock.read }),
      pollMs: 1000,
      yieldTask: () => Promise.resolve(),
      yieldFrame: () => Promise.resolve(),
      wait: (ms) => {
        clock.now += ms;
        run.advance();
        return Promise.resolve();
      },
      onRebuild: () => times.push(clock.now),
    });
    await recorder.start();
    const during = times.slice(0, -1);
    for (let index = 1; index < during.length; index++) {
      assert.ok((during[index] ?? 0) - (during[index - 1] ?? 0) >= 3000);
    }
    assert.ok(times.length >= 3);
    assert.ok(times.length < tiles.length);
  });

  it("keeps what is finished when the run is cancelled", async () => {
    const clock = new FakeClock();
    const tiles = Array.from({ length: 10 }, (_, unit) => tile(unit, 4));
    const run = new FakeRun(tiles, clock);
    run.advance();
    const scene = new StreamedScene();
    let polls = 0;
    const { stream, statuses } = streamOf(run, scene, {
      onWait: () => {
        polls++;
        if (polls === 3) void stream.cancel();
      },
    });
    const progress = await stream.start();

    assert.equal(progress.status, "cancelled");
    assert.equal(progress.cancelRequested, true);
    assert.equal(run.cancels, 1);
    assert.ok(progress.done > 0);
    assert.ok(progress.done < tiles.length);
    assert.equal(progress.done, run.finished);
    assert.equal(progress.objects, run.finished * 4);
    assert.equal(scene.polygons("run-1"), run.finished * 4);
    assert.equal(statuses.at(-1)?.drawn, run.finished * 4);
    assert.equal(progress.tiles.length, run.finished);
  });

  it("follows more pages and does not append a tile twice when the run is opened again", async () => {
    const clock = new FakeClock();
    const tiles = Array.from({ length: 6 }, (_, unit) => tile(unit, 2));
    const run = new FakeRun(tiles, clock, 6, 2);
    run.advance();
    const scene = new StreamedScene();
    const first = await streamOf(run, scene).stream.start();
    assert.equal(first.done, 6);
    assert.equal(first.cursor, 6);
    const again = await streamOf(run, scene, { after: 0 }).stream.start();
    assert.equal(again.objects, 12);
    assert.equal(scene.polygons("run-1"), 12);
  });

  it("replaces a tile that a later stage reports again", async () => {
    const clock = new FakeClock();
    const run = new FakeRun([tile(0, 3)], clock);
    run.advance();
    const scene = new StreamedScene();
    await streamOf(run, scene).stream.start();
    const later: StreamPage = {
      status: "done",
      areas: [
        {
          seq: 9,
          stage: "type",
          unit: 0,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          objects: 5,
          doneAt: 10,
        },
      ],
      after: 9,
      more: false,
      total: 1,
    };
    const typed: RunStreamSource = {
      page: () => Promise.resolve(later),
      objects: () => Promise.resolve(tile(0, 5)),
      cancel: () => Promise.resolve(),
    };
    const progress = await new RunStream({
      lineage: "run-1",
      scene,
      source: typed,
      yieldTask: () => Promise.resolve(),
    }).start();
    assert.equal(progress.objects, 5);
    assert.equal(scene.seqOf("run-1", 0), 9);
  });
});

describe("RunStream closed in the middle of a tile", () => {
  it("appends the whole tile again when the stream is opened again", async () => {
    const clock = new FakeClock();
    const run = new FakeRun([tile(0, 7)], clock);
    run.advance();
    const scene = new StreamedScene();
    const rebuilt: number[] = [];
    let yields = 0;
    const closing: RunStream = new RunStream({
      lineage: "run-1",
      scene,
      source: run,
      slice: 3,
      yieldTask: () => {
        yields++;
        if (yields === 1) closing.close();
        return Promise.resolve();
      },
      yieldFrame: () => Promise.resolve(),
      onRebuild: (blocks) => rebuilt.push(blocks.length),
    });
    await closing.start();
    assert.equal(scene.polygons("run-1"), 3);
    assert.equal(scene.seqOf("run-1", 0), 0);
    assert.deepEqual(rebuilt, []);
    const progress = await streamOf(run, scene).stream.start();
    assert.equal(progress.objects, 7);
  });
});

describe("RebuildGate", () => {
  it("waits 3 s between rebuilds and longer when a rebuild costs more than 5% of that", () => {
    const clock = new FakeClock();
    const gate = new RebuildGate({ now: clock.read });
    assert.equal(gate.due(), true);
    gate.run(() => {
      clock.now += 10;
    });
    assert.equal(gate.due(), false);
    clock.now += 2999;
    assert.equal(gate.due(), false);
    clock.now += 1;
    assert.equal(gate.due(), true);
    gate.run(() => {
      clock.now += 200;
    });
    clock.now += 3999;
    assert.equal(gate.due(), false);
    clock.now += 1;
    assert.equal(gate.due(), true);
    assert.equal(gate.rebuilds, 2);
    assert.equal(gate.spentMs, 210);
  });
});

describe("progress helpers", () => {
  it("estimates the time left from when areas finished", () => {
    assert.equal(estimateRemainingMs(0, 1000, 3, 3, 10), 3500);
    assert.equal(estimateRemainingMs(0, 0, 1, 1, 10), null);
    assert.equal(estimateRemainingMs(0, 1000, 3, 3, null), null);
  });

  it("marks finished tiles as rectangles", () => {
    const marks = finishedTileMarks(
      [
        [0, 0, 10, 10],
        [10, 0, 20, 10],
      ],
      color,
    );
    assert.equal(marks.count, 2);
    assert.equal(marks.indices.length, 12);
  });
});
