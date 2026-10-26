import assert from "node:assert/strict";
import { test } from "node:test";
import { startRegionPass } from "../browser/page/region-pass.ts";
import {
  bindViewerInput,
  type Cancel,
  createInteractionSignal,
  createViewerEngine,
  defaultRestMs,
  type EngineSlide,
  type TimerScheduler,
} from "../src/index.ts";
import {
  FakeClock,
  FakeContainer,
  FakeFrames,
  FakeRenderer,
  FakeResize,
  FakeSource,
  runFrames,
} from "./engine-fakes.ts";

class Timeline implements TimerScheduler {
  time = 0;
  private next = 1;
  private readonly pending = new Map<number, { due: number; callback: () => void }>();

  readonly now = (): number => this.time;

  after(callback: () => void, ms: number): Cancel {
    const id = this.next++;
    this.pending.set(id, { due: this.time + ms, callback });
    return () => {
      this.pending.delete(id);
    };
  }

  pendingCount(): number {
    return this.pending.size;
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = [...this.pending.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((a, b) => a[1].due - b[1].due)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.time = Math.max(this.time, due[1].due);
      due[1].callback();
    }
    this.time = target;
  }
}

function setup() {
  const timeline = new Timeline();
  const signal = createInteractionSignal({ now: timeline.now, timers: timeline });
  const seen: boolean[] = [];
  signal.subscribe((moving) => seen.push(moving));
  return { timeline, signal, seen };
}

test("the signal starts at rest and the default rest time is 200 ms", () => {
  const { signal } = setup();
  assert.equal(signal.moving(), false);
  assert.equal(defaultRestMs, 200);
});

test("a pulse pauses at once and resumes 200 ms after the last pulse", () => {
  const { timeline, signal, seen } = setup();
  signal.pulse();
  assert.equal(signal.moving(), true);
  timeline.advance(150);
  signal.pulse();
  timeline.advance(199);
  assert.equal(signal.moving(), true);
  assert.deepEqual(seen, [true]);
  timeline.advance(1);
  assert.equal(signal.moving(), false);
  assert.deepEqual(seen, [true, false]);
});

test("a long stream of pulses keeps one timer and announces the pause once", () => {
  const { timeline, signal, seen } = setup();
  for (let frame = 0; frame < 120; frame++) {
    signal.pulse();
    timeline.advance(16);
  }
  assert.equal(timeline.pendingCount(), 1);
  assert.deepEqual(seen, [true]);
  timeline.advance(200);
  assert.deepEqual(seen, [true, false]);
  assert.equal(timeline.pendingCount(), 0);
});

test("a signal nobody listens to arms no timer, and a late listener gets the rest announcement", () => {
  const timeline = new Timeline();
  const signal = createInteractionSignal({ now: timeline.now, timers: timeline });
  signal.pulse();
  assert.equal(timeline.pendingCount(), 0);
  assert.equal(signal.moving(), true);
  timeline.advance(50);
  const seen: boolean[] = [];
  const stop = signal.subscribe((moving) => seen.push(moving));
  assert.equal(timeline.pendingCount(), 1);
  timeline.advance(150);
  assert.deepEqual(seen, [false]);
  signal.pulse();
  stop();
  assert.equal(timeline.pendingCount(), 0);
});

test("a held gesture keeps the signal moving without pulses and rests 200 ms after release", () => {
  const { timeline, signal, seen } = setup();
  const release = signal.hold();
  timeline.advance(5000);
  assert.equal(signal.moving(), true);
  assert.equal(timeline.pendingCount(), 0);
  release();
  release();
  assert.equal(signal.moving(), true);
  timeline.advance(199);
  assert.equal(signal.moving(), true);
  timeline.advance(1);
  assert.equal(signal.moving(), false);
  assert.deepEqual(seen, [true, false]);
});

test("two holds need two releases", () => {
  const { timeline, signal } = setup();
  const first = signal.hold();
  const second = signal.hold();
  first();
  timeline.advance(1000);
  assert.equal(signal.moving(), true);
  second();
  timeline.advance(200);
  assert.equal(signal.moving(), false);
});

test("whenRested resolves at once at rest and after the rest time while moving", async () => {
  const { timeline, signal } = setup();
  await signal.whenRested();
  signal.pulse();
  let rested = false;
  const waiting = signal.whenRested().then(() => {
    rested = true;
  });
  await Promise.resolve();
  assert.equal(rested, false);
  timeline.advance(199);
  await Promise.resolve();
  assert.equal(rested, false);
  timeline.advance(1);
  await waiting;
  assert.equal(rested, true);
});

test("whenRested waits through a pulse that lands while it waits", async () => {
  const { timeline, signal } = setup();
  signal.pulse();
  let rested = false;
  const waiting = signal.whenRested().then(() => {
    rested = true;
  });
  timeline.advance(150);
  signal.pulse();
  timeline.advance(150);
  await Promise.resolve();
  assert.equal(rested, false);
  timeline.advance(50);
  await waiting;
  assert.equal(timeline.time, 350);
});

test("whenRested rejects when aborted and resolves when the signal is disposed", async () => {
  const { signal } = setup();
  signal.pulse();
  const abort = new AbortController();
  const aborted = signal.whenRested(abort.signal);
  abort.abort(new Error("cancelled"));
  await assert.rejects(aborted, /cancelled/);
  const waiting = signal.whenRested();
  signal.dispose();
  await waiting;
  assert.equal(signal.moving(), false);
});

test("a signal without timers still reports movement from the clock but cannot announce rest", async () => {
  const clock = new FakeClock();
  const signal = createInteractionSignal({ now: clock.now, timers: null });
  signal.pulse();
  assert.equal(signal.moving(), true);
  await assert.rejects(signal.whenRested(), /without timers/);
  clock.advance(200);
  assert.equal(signal.moving(), false);
  await signal.whenRested();
});

test("dispose clears the timer and ignores later pulses", () => {
  const { timeline, signal } = setup();
  signal.pulse();
  signal.dispose();
  assert.equal(timeline.pendingCount(), 0);
  signal.pulse();
  assert.equal(signal.moving(), false);
});

function engineSetup() {
  const timeline = new Timeline();
  const signal = createInteractionSignal({ now: timeline.now, timers: timeline });
  const renderer = new FakeRenderer();
  const source = new FakeSource();
  const frames = new FakeFrames();
  const clock = new FakeClock();
  const container = new FakeContainer();
  const engine = createViewerEngine<EngineSlide>({
    createRenderer: renderer.create,
    openSlide: source.open,
    frames,
    now: clock.now,
    reducedMotion: () => false,
    observeResize: new FakeResize().observe,
    interaction: signal,
  });
  engine.mount(container);
  return { engine, signal, timeline, frames, clock, container };
}

test("every camera change from the engine pulses the signal and a still camera does not", async () => {
  const { engine, signal, timeline, frames, clock } = engineSetup();
  await engine.openSlide({ id: "a" });
  runFrames(frames, clock);
  timeline.advance(1000);
  assert.equal(engine.interaction, signal);
  assert.equal(signal.moving(), false);
  engine.panBy(10, 0);
  assert.equal(signal.moving(), true);
  timeline.advance(200);
  assert.equal(signal.moving(), false);
  engine.zoomBy(1, undefined, { animate: false });
  assert.equal(signal.moving(), true);
  timeline.advance(200);
  engine.panBy(0, 0);
  assert.equal(signal.moving(), false);
});

test("an eased zoom keeps the signal moving until 200 ms after its last frame", async () => {
  const { engine, signal, timeline, frames, clock } = engineSetup();
  await engine.openSlide({ id: "a" });
  runFrames(frames, clock);
  timeline.advance(1000);
  engine.zoomBy(1);
  let framesRun = 0;
  while (frames.pending.size > 0 && framesRun < 100) {
    clock.advance(16);
    timeline.advance(16);
    frames.flush();
    framesRun += 1;
    if (engine.getMotion() !== "idle") assert.equal(signal.moving(), true);
  }
  assert.equal(engine.getMotion(), "idle");
  assert.equal(signal.moving(), true);
  timeline.advance(199);
  assert.equal(signal.moving(), true);
  timeline.advance(1);
  assert.equal(signal.moving(), false);
});

test("the engine disposes a signal it made and leaves one it was given", () => {
  const given = engineSetup();
  given.engine.dispose();
  given.signal.pulse();
  assert.equal(given.signal.moving(), true);
  const own = createViewerEngine({
    createRenderer: new FakeRenderer().create,
    openSlide: new FakeSource().open,
    frames: new FakeFrames(),
    now: new FakeClock().now,
  });
  own.interaction.pulse();
  assert.equal(own.interaction.moving(), true);
  own.dispose();
  assert.equal(own.interaction.moving(), false);
});

type Listener = (event: unknown) => void;

class FakeTarget {
  readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Record<string, unknown>) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

class FakeElement extends FakeTarget {
  readonly style = {
    touchAction: "",
    userSelect: "",
    cursor: "",
    overscrollBehavior: "",
    setProperty: () => {},
    removeProperty: () => {},
  };
  readonly page = new FakePage();
  readonly ownerDocument = this.page;

  setPointerCapture() {}
  hasPointerCapture() {
    return false;
  }
  releasePointerCapture() {}
}

class FakePage extends FakeTarget {
  readonly defaultView = new FakeTarget();
  readonly documentElement = { style: { overscrollBehavior: "" } };
  visibilityState = "visible";
}

function pointerEvent(clientX: number, clientY: number, buttons: number) {
  return {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons,
    clientX,
    clientY,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    timeStamp: 0,
    cancelable: true,
    preventDefault: () => {},
  };
}

test("a held pointer gesture pauses the signal while still and a wheel zoom pulses it", () => {
  const timeline = new Timeline();
  const signal = createInteractionSignal({ now: timeline.now, timers: timeline });
  const element = new FakeElement();
  const calls: string[] = [];
  const binding = bindViewerInput(element as unknown as HTMLElement, {
    startDrag: () => calls.push("startDrag"),
    dragTo: () => calls.push("dragTo"),
    endDrag: () => calls.push("endDrag"),
    stopMotion: () => calls.push("stopMotion"),
    panBy: () => calls.push("panBy"),
    zoomBy: () => calls.push("zoomBy"),
    interaction: signal,
  });
  assert.equal(signal.moving(), false);
  element.dispatch("pointerdown", pointerEvent(100, 100, 1));
  assert.equal(signal.moving(), true);
  timeline.advance(5000);
  assert.equal(signal.moving(), true);
  element.page.defaultView.dispatch("pointerup", pointerEvent(100, 100, 0));
  assert.equal(signal.moving(), true);
  timeline.advance(200);
  assert.equal(signal.moving(), false);
  element.dispatch("wheel", {
    ...pointerEvent(100, 100, 0),
    deltaX: 0,
    deltaY: -100,
    deltaMode: 0,
  });
  assert.ok(calls.includes("zoomBy"));
  assert.equal(signal.moving(), true);
  binding.dispose();
});

test("the region pass stand-in waits for rest before every region and finishes after it", async () => {
  const { timeline, signal } = setup();
  const spun: number[] = [];
  signal.pulse();
  const pass = startRegionPass({
    regions: 3,
    sliceMs: 40,
    now: timeline.now,
    yieldToMain: () => Promise.resolve(),
    gate: signal,
    spin: (ms) => spun.push(ms),
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(pass.completed(), 0);
  timeline.advance(150);
  signal.pulse();
  timeline.advance(150);
  await Promise.resolve();
  assert.equal(pass.completed(), 0);
  timeline.advance(50);
  assert.equal(await pass.finished, 3);
  assert.deepEqual(spun, [40, 40, 40]);
});

test("the region pass stand-in without a gate never waits", async () => {
  const pass = startRegionPass({
    regions: 4,
    sliceMs: 1,
    now: () => 0,
    yieldToMain: () => Promise.resolve(),
    spin: () => {},
  });
  assert.equal(await pass.finished, 4);
  assert.equal(pass.waits(), 0);
});
