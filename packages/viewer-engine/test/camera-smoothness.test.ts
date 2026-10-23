import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Camera,
  type CameraMotion,
  type CameraProfile,
  type CameraProfilePreset,
  type ClientPoint,
  cameraProfiles,
  createViewerEngine,
  type EngineSlide,
  type FlightEnd,
  type ScreenRect,
  sameCamera,
  screenToSlide,
  type ViewerEngine,
  wheelZoomOctaves,
} from "../src/index.ts";
import {
  FakeClock,
  FakeContainer,
  FakeFrames,
  FakeRenderer,
  FakeResize,
  fakeSlide,
} from "./engine-fakes.ts";

interface Step {
  readonly at: number;
  readonly act: (
    engine: ViewerEngine,
    profile: CameraProfile,
    flights: Promise<FlightEnd>[],
  ) => void;
}

interface Scenario {
  readonly name: string;
  readonly slide: { readonly width: number; readonly height: number };
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly start?: Camera;
  readonly script: readonly Step[];
  readonly cursor?: ClientPoint;
  readonly check?: (run: Run, profile: CameraProfilePreset) => void;
}

interface Sample {
  readonly time: number;
  readonly camera: Camera;
  readonly source: "start" | "input" | "frame";
  readonly before: CameraMotion;
}

interface Run {
  readonly samples: readonly Sample[];
  readonly rect: ScreenRect;
  readonly engine: ViewerEngine;
  readonly frames: FakeFrames;
  readonly idleFrames: number;
  readonly flights: readonly FlightEnd[];
}

const frameRates: Record<string, () => () => number> = {
  "30 Hz": () => () => 1000 / 30,
  "60 Hz": () => () => 1000 / 60,
  "120 Hz": () => () => 1000 / 120,
  jittery: () => {
    let seed = 0x2f6e2b1;
    return () => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return 4 + (seed / 2 ** 32) * 46;
    };
  },
};

const reference = () => () => 1;

const presets = Object.keys(cameraProfiles) as CameraProfilePreset[];

async function play(scenario: Scenario, preset: CameraProfilePreset, interval: () => number) {
  const profile = cameraProfiles[preset];
  const frames = new FakeFrames();
  const clock = new FakeClock();
  const container = new FakeContainer();
  const viewport = scenario.viewport ?? { width: 800, height: 600 };
  container.rect = { left: 100, top: 50, ...viewport };
  const engine = createViewerEngine<EngineSlide>({
    createRenderer: new FakeRenderer().create,
    openSlide: (ref) =>
      Promise.resolve(fakeSlide(ref.id, scenario.slide.width, scenario.slide.height)),
    frames,
    now: clock.now,
    reducedMotion: () => false,
    devicePixelRatio: () => 1,
    cameraProfile: profile,
    observeResize: new FakeResize().observe,
  });
  engine.mount(container);
  await engine.openSlide({ id: scenario.name });
  if (scenario.start) engine.setCamera(scenario.start);
  frames.flush();

  const flights: Promise<FlightEnd>[] = [];
  const samples: Sample[] = [
    { time: -1, camera: engine.getCamera(), source: "start", before: "idle" },
  ];
  const origin = clock.time;
  let vsync = origin;
  let next = 0;
  let idleFrames = 0;
  let actedSinceFrame = false;
  for (let tick = 0; ; tick += 1) {
    if (tick > 20_000) throw new Error(`${scenario.name} never settled`);
    vsync += interval();
    while (next < scenario.script.length) {
      const step = scenario.script[next];
      if (!step || origin + step.at > vsync) break;
      clock.time = origin + step.at;
      const before = engine.getMotion();
      step.act(engine, profile, flights);
      samples.push({ time: step.at, camera: engine.getCamera(), source: "input", before });
      actedSinceFrame = true;
      next += 1;
    }
    if (frames.pending.size > 0) {
      clock.time = vsync;
      const before = engine.getMotion();
      const previous = engine.getCamera();
      frames.flush();
      const camera = engine.getCamera();
      if (sameCamera(previous, camera) && !actedSinceFrame) idleFrames += 1;
      actedSinceFrame = false;
      samples.push({ time: vsync - origin, camera, source: "frame", before });
    } else if (next >= scenario.script.length) {
      break;
    }
  }
  const run: Run = {
    samples,
    rect: container.rect,
    engine,
    frames,
    idleFrames,
    flights: await Promise.all(flights),
  };
  return run;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function viewPoints(camera: Camera, rect: ScreenRect): Point[] {
  const scale = 2 ** camera.zoom;
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  return [
    [0, 0],
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [-halfWidth, halfHeight],
    [halfWidth, halfHeight],
  ].map(([sx = 0, sy = 0]) => ({ x: camera.x + sx / scale, y: camera.y + sy / scale }));
}

function onScreen(camera: Camera, point: Point): Point {
  const scale = 2 ** camera.zoom;
  return { x: (point.x - camera.x) * scale, y: (point.y - camera.y) * scale };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function screenJump(a: Camera, b: Camera, rect: ScreenRect): number {
  return Math.max(
    ...viewPoints(a, rect).map((point) => distance(onScreen(a, point), onScreen(b, point))),
  );
}

function framesOf(run: Run): Sample[] {
  return run.samples.filter((sample) => sample.source !== "input");
}

function assertNoJumps(label: string, run: Run, ideal: Run) {
  const frames = framesOf(run);
  for (let index = 1; index < frames.length; index += 1) {
    const sample = frames[index];
    const previous = frames[index - 1];
    if (!sample || !previous) continue;
    const entering = ideal.samples.findLastIndex((step) => step.time < previous.time - 1);
    const leaving = ideal.samples.findLastIndex((step) => step.time <= sample.time + 1);
    const path = ideal.samples.slice(Math.max(0, entering), leaving + 1);
    for (const point of viewPoints(previous.camera, run.rect)) {
      const jump = distance(onScreen(previous.camera, point), onScreen(sample.camera, point));
      let travel = 0;
      for (let leg = 1; leg < path.length; leg += 1) {
        const from = path[leg - 1];
        const to = path[leg];
        if (from && to)
          travel += distance(onScreen(from.camera, point), onScreen(to.camera, point));
      }
      const allowed = travel * 1.01 + 0.5;
      assert.ok(
        jump <= allowed,
        `${label}: content jumped ${jump.toFixed(2)} px between frames at ${previous.time.toFixed(1)} and ${sample.time.toFixed(1)} ms where the motion moves it ${travel.toFixed(2)} px`,
      );
    }
  }
}

const finiteCamera = (camera: Camera) =>
  Number.isFinite(camera.x) && Number.isFinite(camera.y) && Number.isFinite(camera.zoom);

function assertSmooth(label: string, run: Run, ideal: Run, scenario: Scenario) {
  const bounds = run.engine.getCameraBounds();
  const extent = bounds.extent;
  for (const sample of run.samples) {
    assert.ok(finiteCamera(sample.camera), `${label}: a camera at ${sample.time} ms is not finite`);
    const { x, y, zoom } = sample.camera;
    assert.ok(
      zoom >= bounds.minZoom - 1e-9 && zoom <= bounds.maxZoom + 1e-9,
      `${label}: zoom ${zoom}`,
    );
    if (extent) {
      assert.ok(
        x >= 0 && x <= extent.width && y >= 0 && y <= extent.height,
        `${label}: centre off the slide`,
      );
    }
  }

  assertNoJumps(label, run, ideal);

  for (let index = 1; index < run.samples.length; index += 1) {
    const sample = run.samples[index];
    const previous = run.samples[index - 1];
    if (!sample || !previous) continue;
    if (
      sample.source === "frame" &&
      sample.before === "zooming" &&
      sample.camera.zoom === previous.camera.zoom
    ) {
      assert.ok(
        sample.camera.x === previous.camera.x && sample.camera.y === previous.camera.y,
        `${label}: the centre drifted at ${sample.time.toFixed(1)} ms while the zoom held still`,
      );
    }
  }

  if (scenario.cursor) {
    const cursor = scenario.cursor;
    const first = run.samples[0]?.camera;
    assert.ok(first);
    const anchor = screenToSlide(first, run.rect, cursor.clientX, cursor.clientY);
    for (const sample of run.samples) {
      const point = screenToSlide(sample.camera, run.rect, cursor.clientX, cursor.clientY);
      const offScreen =
        Math.hypot(point.x - anchor.x, point.y - anchor.y) * 2 ** sample.camera.zoom;
      assert.ok(offScreen < 1e-6, `${label}: the point under the cursor moved ${offScreen} px`);
    }
  }

  const end = run.samples.at(-1)?.camera;
  const idealEnd = ideal.samples.at(-1)?.camera;
  assert.ok(end && idealEnd);
  assert.ok(
    Math.abs(end.zoom - idealEnd.zoom) < 1e-6,
    `${label}: ends at zoom ${end.zoom}, not ${idealEnd.zoom}`,
  );
  const apart = screenJump(end, idealEnd, run.rect);
  assert.ok(apart < 0.05, `${label}: ends ${apart} px from where the 1 ms run ends`);
  assert.deepEqual(run.flights, ideal.flights, `${label}: flights ended differently`);

  assert.equal(run.engine.getMotion(), "idle", `${label}: still moving`);
  assert.equal(run.frames.pending.size, 0, `${label}: a frame is still requested`);
  assert.equal(run.idleFrames, 0, `${label}: ${run.idleFrames} frames ran with nothing to do`);
}

const centre = { x: 50_000, y: 40_000 };
const big = { width: 100_000, height: 80_000 };
const small = { width: 10_000, height: 8000 };

const wheel = (at: number, travel: number, point: ClientPoint): Step => ({
  at,
  act: (engine, profile) => engine.zoomBy(wheelZoomOctaves(profile, travel, "wheel"), point),
});

const throwSteps = (start: number, from: ClientPoint, dx: number, dy: number): Step[] => {
  const steps: Step[] = [{ at: start, act: (engine) => engine.startDrag(from) }];
  for (let sample = 1; sample <= 6; sample += 1) {
    steps.push({
      at: start + sample * 8,
      act: (engine) =>
        engine.dragTo({ clientX: from.clientX + dx * sample, clientY: from.clientY + dy * sample }),
    });
  }
  steps.push({ at: start + 48, act: (engine) => engine.endDrag() });
  return steps;
};

const fly = (at: number, target: Camera): Step => ({
  at,
  act: (engine, _profile, flights) => {
    flights.push(engine.flyTo(target));
  },
});

const switchTo = (at: number, preset: CameraProfilePreset): Step => ({
  at,
  act: (engine) => engine.setCameraProfile(cameraProfiles[preset]),
});

function zooms(run: Run): number[] {
  return run.samples.map((sample) => sample.camera.zoom);
}

const nonDecreasing = (values: readonly number[]) =>
  values.every((value, index) => index === 0 || value >= (values[index - 1] ?? value));

const flightTarget = { x: 92_000, y: 71_000, zoom: 0 };

const scenarios: Scenario[] = [
  {
    name: "a wheel burst zooming in at the cursor",
    slide: big,
    start: { ...centre, zoom: -3 },
    cursor: { clientX: 700, clientY: 200 },
    script: Array.from({ length: 8 }, (_, index) =>
      wheel(index * 40, -100, { clientX: 700, clientY: 200 }),
    ),
    check: (run) => {
      assert.ok(nonDecreasing(zooms(run)));
      const end = run.samples.at(-1)?.camera.zoom ?? 0;
      const step = wheelZoomOctaves(cameraProfiles.smooth, -100, "wheel");
      assert.ok(Math.abs(end - (-3 + 8 * step)) < 1e-9);
    },
  },
  {
    name: "a wheel burst in and back out at the cursor",
    slide: big,
    start: { ...centre, zoom: -2 },
    cursor: { clientX: 300, clientY: 500 },
    script: [
      ...Array.from({ length: 5 }, (_, index) =>
        wheel(index * 30, -100, { clientX: 300, clientY: 500 }),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        wheel(150 + index * 30, 100, { clientX: 300, clientY: 500 }),
      ),
    ],
    check: (run) => {
      const step = wheelZoomOctaves(cameraProfiles.smooth, -100, "wheel");
      assert.ok(zooms(run).every((zoom) => zoom <= -2 + 5 * step + 1e-9));
      assert.ok(Math.abs((run.samples.at(-1)?.camera.zoom ?? 0) - -2) < 1e-9);
    },
  },
  {
    name: "a fast wheel burst past the deepest zoom near a corner",
    slide: small,
    start: { x: 9990, y: 10, zoom: 3 },
    script: Array.from({ length: 10 }, (_, index) =>
      wheel(index * 20, -400, { clientX: 850, clientY: 80 }),
    ),
    check: (run) => {
      assert.equal(run.samples.at(-1)?.camera.zoom, run.engine.getCameraBounds().maxZoom);
      assert.ok(nonDecreasing(zooms(run)));
    },
  },
  {
    name: "a wheel burst past the widest zoom at an edge",
    slide: small,
    start: { x: 9900, y: 7900, zoom: 0 },
    script: Array.from({ length: 20 }, (_, index) =>
      wheel(index * 15, 400, { clientX: 850, clientY: 600 }),
    ),
    check: (run) => {
      assert.equal(run.samples.at(-1)?.camera.zoom, run.engine.getCameraBounds().minZoom);
    },
  },
  {
    name: "a throw across open tissue",
    slide: big,
    start: { ...centre, zoom: -1 },
    script: throwSteps(0, { clientX: 400, clientY: 300 }, -25, 10),
    check: (run) => {
      const xs = run.samples.map((sample) => sample.camera.x);
      assert.ok(nonDecreasing(xs));
    },
  },
  {
    name: "a throw into the right edge",
    slide: small,
    start: { x: 9700, y: 4000, zoom: 0 },
    script: throwSteps(0, { clientX: 400, clientY: 300 }, -40, 0),
    check: (run, preset) => {
      if (preset === "smooth") assert.equal(run.samples.at(-1)?.camera.x, small.width);
      assert.ok(nonDecreasing(run.samples.map((sample) => sample.camera.x)));
    },
  },
  {
    name: "a diagonal throw into the top left corner",
    slide: small,
    start: { x: 400, y: 300, zoom: 0 },
    script: throwSteps(0, { clientX: 400, clientY: 300 }, 30, 20),
    check: (run, preset) => {
      const end = run.samples.at(-1)?.camera;
      if (preset === "smooth") assert.deepEqual(end, { x: 0, y: 0, zoom: 0 });
    },
  },
  {
    name: "a long flight from deep zoom",
    slide: big,
    start: { x: 5000, y: 5000, zoom: 1 },
    script: [fly(0, flightTarget)],
    check: (run) => {
      assert.deepEqual(run.samples.at(-1)?.camera, flightTarget);
      assert.deepEqual(run.flights, ["arrived"]);
      const dx = flightTarget.x - 5000;
      const dy = flightTarget.y - 5000;
      for (const sample of run.samples) {
        const share =
          ((sample.camera.x - 5000) * dx + (sample.camera.y - 5000) * dy) / (dx * dx + dy * dy);
        assert.ok(share >= -1e-9 && share <= 1 + 1e-9, `share ${share}`);
        assert.ok(sample.camera.zoom <= 1 + 1e-9);
      }
    },
  },
  {
    name: "a short flight to a nearby area",
    slide: big,
    start: { ...centre, zoom: -1 },
    script: [
      {
        at: 0,
        act: (engine, _profile, flights) => {
          flights.push(engine.flyToArea({ x: 50_400, y: 40_100, width: 400, height: 300 }));
        },
      },
    ],
    check: (run) => {
      assert.deepEqual(run.samples.at(-1)?.camera, { x: 50_600, y: 40_250, zoom: 1 });
    },
  },
  {
    name: "a flight interrupted by another flight, a pan and a zoom",
    slide: big,
    start: { x: 5000, y: 5000, zoom: 0 },
    script: [
      fly(0, flightTarget),
      fly(230, { x: 20_000, y: 60_000, zoom: -2 }),
      { at: 450, act: (engine) => engine.panBy(30, -20) },
      wheel(500, -100, { clientX: 500, clientY: 350 }),
    ],
  },
  {
    name: "a flight interrupted by a drag and a throw",
    slide: big,
    start: { x: 5000, y: 5000, zoom: 0 },
    script: [fly(0, flightTarget), ...throwSteps(200, { clientX: 400, clientY: 300 }, 20, 20)],
  },
  {
    name: "profile switches during a zoom, a coast and a flight",
    slide: big,
    start: { ...centre, zoom: -2 },
    script: [
      wheel(0, -100, { clientX: 600, clientY: 300 }),
      wheel(30, -100, { clientX: 600, clientY: 300 }),
      switchTo(50, "precise"),
      wheel(80, -100, { clientX: 600, clientY: 300 }),
      switchTo(120, "smooth"),
      ...throwSteps(300, { clientX: 400, clientY: 300 }, -30, 0),
      switchTo(420, "instant"),
      switchTo(500, "smooth"),
      ...throwSteps(600, { clientX: 400, clientY: 300 }, 30, 0),
      switchTo(700, "precise"),
      fly(900, flightTarget),
      switchTo(1000, "precise"),
      switchTo(1100, "instant"),
    ],
  },
  {
    name: "a 1 px slide",
    slide: { width: 1, height: 1 },
    script: [
      wheel(0, -100, { clientX: 700, clientY: 100 }),
      wheel(20, 100, { clientX: 700, clientY: 100 }),
      ...throwSteps(100, { clientX: 400, clientY: 300 }, -30, 30),
      fly(400, { x: 0.25, y: 0.75, zoom: 4 }),
      fly(900, { x: 1, y: 1, zoom: -3 }),
    ],
  },
  {
    name: "a 200k px slide flown from deepest to widest and back",
    slide: { width: 200_000, height: 200_000 },
    start: { x: 100_000, y: 100_000, zoom: 4 },
    script: [
      fly(0, { x: 100_000.5, y: 100_000, zoom: -20 }),
      fly(800, { x: 3, y: 199_990, zoom: 4 }),
      ...throwSteps(1600, { clientX: 400, clientY: 300 }, 40, -40),
    ],
  },
  {
    name: "a viewport of zero size",
    slide: big,
    viewport: { width: 0, height: 0 },
    script: [
      wheel(0, -100, { clientX: 100, clientY: 50 }),
      ...throwSteps(50, { clientX: 100, clientY: 50 }, -30, 0),
      fly(200, { x: 1000, y: 1000, zoom: 0 }),
    ],
  },
];

for (const scenario of scenarios) {
  for (const preset of presets) {
    test(`${scenario.name} stays smooth under ${preset} at every frame rate`, async () => {
      const ideal = await play(scenario, preset, reference());
      assertSmooth(`${scenario.name}, ${preset}, 1 ms`, ideal, ideal, scenario);
      scenario.check?.(ideal, preset);
      for (const [rate, interval] of Object.entries(frameRates)) {
        const label = `${scenario.name}, ${preset}, ${rate}`;
        const run = await play(scenario, preset, interval());
        assertSmooth(label, run, ideal, scenario);
        scenario.check?.(run, preset);
      }
    });
  }
}
