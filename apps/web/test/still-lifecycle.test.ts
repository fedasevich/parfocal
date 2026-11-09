import assert from "node:assert/strict";
import { test } from "node:test";
import { runStillEngine, type StillLink, type StillModule } from "../src/viewer/still-lifecycle.ts";

type Calls = {
  links: (StillLink | null)[];
  tiles: number[];
  cleared: number;
  disposed: number;
  failed: number;
};

function fakeModule(calls: Calls, failedTiles: () => number) {
  let routeError: ((error: Error) => void) | undefined;
  let tileError: ((error: Error) => void) | undefined;
  let idle: () => void = () => {};
  const idleNow = new Promise<void>((resolve) => {
    idle = resolve;
  });
  const route = {
    whenIdle: () => idleNow,
    failedTiles: (): unknown[] => Array.from({ length: failedTiles() }),
  };
  const engine = { getCameraBounds: () => ({ minZoom: -4, maxZoom: 4 }) };
  const module = {
    createSlideAccess: () => ({ access: {}, grant: () => Promise.resolve({}) }),
    signedOpenRequest: () => ({}),
    clampCamera: (camera: unknown) => camera,
    objectColour: () => [0, 0, 0],
    createObjectDrawing: () => ({
      clear: () => {
        calls.cleared += 1;
      },
    }),
    mountSlideViewport: (options: {
      route: { onError: (error: Error) => void; onTileError: (error: Error) => void };
    }) => {
      routeError = options.route.onError;
      tileError = options.route.onTileError;
      return {
        engine,
        ready: Promise.resolve({ width: 1024, height: 768 }),
        route: () => route,
        dispose: () => {
          calls.disposed += 1;
        },
      };
    },
  } as unknown as StillModule;
  return {
    module,
    idle: () => idle(),
    routeError: () => routeError?.(new Error("gpu")),
    tileError: () => tileError?.(new Error("tile")),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function start(fake: ReturnType<typeof fakeModule>, calls: Calls) {
  return runStillEngine({
    module: fake.module,
    container: {} as HTMLElement,
    slideId: "slide",
    grant: () =>
      Promise.resolve({
        token: "",
        lifetimeSeconds: 1,
        basePath: "",
        original: "",
        format: null,
      }),
    onOpened: () => {},
    onLink: (link) => calls.links.push(link),
    onTiles: (failed) => calls.tiles.push(failed),
    onFail: () => {
      calls.failed += 1;
      calls.links.push(null);
    },
  });
}

const fresh = (): Calls => ({ links: [], tiles: [], cleared: 0, disposed: 0, failed: 0 });

test("a GPU failure before the slide settles never reports a live link and releases the engine", async () => {
  const calls = fresh();
  const fake = fakeModule(calls, () => 0);
  start(fake, calls);
  await settle();
  fake.routeError();
  fake.idle();
  await settle();
  assert.deepEqual(calls.links, [null]);
  assert.equal(calls.disposed, 1);
  assert.equal(calls.cleared, 1);
});

test("a GPU failure after ready reports no link and releases the engine once", async () => {
  const calls = fresh();
  const fake = fakeModule(calls, () => 0);
  const stop = start(fake, calls);
  fake.idle();
  await settle();
  assert.equal(calls.links.length, 1);
  assert.notEqual(calls.links[0], null);
  fake.routeError();
  await settle();
  stop();
  assert.equal(calls.links.at(-1), null);
  assert.equal(calls.disposed, 1);
});

test("leaving clears the drawing before the viewport is disposed", async () => {
  const order: string[] = [];
  const calls = fresh();
  const fake = fakeModule(calls, () => 0);
  const stop = runStillEngine({
    module: {
      ...fake.module,
      createObjectDrawing: () => ({ clear: () => order.push("clear") }),
      mountSlideViewport: (options: Parameters<StillModule["mountSlideViewport"]>[0]) => {
        const viewport = fake.module.mountSlideViewport(options);
        return { ...viewport, dispose: () => order.push("dispose") };
      },
    } as unknown as StillModule,
    container: {} as HTMLElement,
    slideId: "slide",
    grant: () =>
      Promise.resolve({
        token: "",
        lifetimeSeconds: 1,
        basePath: "",
        original: "",
        format: null,
      }),
    onOpened: () => {},
    onLink: () => {},
    onTiles: () => {},
    onFail: () => {},
  });
  fake.idle();
  await settle();
  stop();
  assert.deepEqual(order, ["clear", "dispose"]);
});

test("tile failures are counted from the route once it settles and clear when the tiles return", async () => {
  const calls = fresh();
  let failing = 3;
  const fake = fakeModule(calls, () => failing);
  start(fake, calls);
  fake.tileError();
  fake.tileError();
  fake.tileError();
  fake.idle();
  await settle();
  assert.deepEqual(calls.tiles.slice(0, 1), [3]);
  failing = 0;
  fake.tileError();
  await settle();
  assert.equal(calls.tiles.at(-1), 0);
});
