import assert from "node:assert/strict";
import { test } from "node:test";
import { createCameraInput } from "../src/devices/camera-input.ts";
import type { LegendContext } from "../src/devices/device-legend.ts";
import type { Intent } from "../src/devices/intents.ts";
import {
  bindSpaceMouse,
  createSpaceMouseReader,
  type HidDeviceLike,
  type HidInputReportEvent,
  type HidLike,
  hasWebHid,
  requestSpaceMouse,
} from "../src/devices/spacemouse-source.ts";

const triple = (x: number, y: number, z: number) => {
  const view = new DataView(new ArrayBuffer(6));
  view.setInt16(0, x, true);
  view.setInt16(2, y, true);
  view.setInt16(4, z, true);
  return view;
};

const buttons = (mask: number) => new DataView(new Uint8Array([mask, 0, 0, 0]).buffer);

const recorded = {
  idle: { reportId: 1, data: triple(0, 0, 0) },
  tiltRight: { reportId: 1, data: triple(350, 0, 0) },
  halfTiltRight: { reportId: 1, data: triple(175, 0, 0) },
  tiltAway: { reportId: 1, data: triple(0, -350, 0) },
  push: { reportId: 1, data: triple(0, 0, 350) },
  pull: { reportId: 1, data: triple(0, 0, -200) },
  fullPull: { reportId: 1, data: triple(0, 0, -350) },
  twist: { reportId: 2, data: triple(0, 300, 0) },
  left: { reportId: 3, data: buttons(0b0001) },
  right: { reportId: 3, data: buttons(0b0010) },
  sideNext: { reportId: 3, data: buttons(0b0100) },
  sidePrevious: { reportId: 3, data: buttons(0b1000) },
  released: { reportId: 3, data: buttons(0) },
};

const harness = (context: LegendContext = "review", rotation = false) => {
  const intents: Intent[] = [];
  const pans: number[][] = [];
  const zooms: number[] = [];
  const input = createCameraInput({
    device: () => "spacemouse",
    context: () => context,
    calibration: () => ({ deadZone: 10, speed: 60 }),
    camera: {
      panBy: (dx, dy) => pans.push([dx, dy]),
      zoomBy: (octaves) => zooms.push(octaves),
    },
    onIntent: (intent) => intents.push(intent),
  });
  const reader = createSpaceMouseReader({ rotation: () => rotation });
  const feed = (report: { reportId: number; data: DataView }) => {
    for (const raw of reader.read(report)) input.push(raw, 16);
  };
  return { intents, pans, zooms, feed, reader, input };
};

const kinds = (intents: Intent[]) => intents.map((intent) => intent.kind);

test("tilt pans by deflection, away from the user pans the other way", () => {
  const rig = harness();
  rig.feed(recorded.idle);
  assert.deepEqual(rig.pans, []);
  rig.feed(recorded.tiltRight);
  rig.feed(recorded.halfTiltRight);
  const [full, half] = rig.pans.map((pan) => pan[0] ?? 0);
  assert.ok((full ?? 0) < 0);
  assert.ok(Math.abs(half ?? 0) < Math.abs(full ?? 0));
  rig.feed(recorded.tiltAway);
  assert.ok((rig.pans.at(-1)?.[1] ?? 0) > 0);
});

test("push zooms in and pull zooms out", () => {
  const rig = harness();
  rig.feed(recorded.push);
  assert.ok((rig.zooms.at(-1) ?? 0) > 0);
  rig.feed(recorded.pull);
  assert.ok((rig.zooms.at(-1) ?? 0) < 0);
});

test("a full pull peeks in read and releases when the cap returns", () => {
  const rig = harness("read");
  rig.feed(recorded.pull);
  assert.ok(!kinds(rig.intents).includes("peek"));
  rig.feed(recorded.fullPull);
  assert.deepEqual(
    rig.intents.filter((intent) => intent.kind === "peek"),
    [{ kind: "peek", held: true }],
  );
  rig.feed(recorded.idle);
  assert.deepEqual(rig.intents.filter((intent) => intent.kind === "peek").at(-1), {
    kind: "peek",
    held: false,
  });
});

test("a full pull does not peek in review", () => {
  const rig = harness("review");
  rig.feed(recorded.fullPull);
  rig.feed(recorded.idle);
  assert.ok(!kinds(rig.intents).includes("peek"));
});

test("side buttons step presets in read", () => {
  const rig = harness("read");
  rig.feed(recorded.sideNext);
  rig.feed(recorded.released);
  rig.feed(recorded.sidePrevious);
  assert.deepEqual(
    rig.intents.filter((intent) => intent.kind === "presetStep"),
    [
      { kind: "presetStep", step: 1 },
      { kind: "presetStep", step: -1 },
    ],
  );
});

test("buttons give next cell and keep in review, once per press", () => {
  const rig = harness("review");
  rig.feed(recorded.left);
  rig.feed(recorded.left);
  rig.feed(recorded.released);
  rig.feed(recorded.right);
  assert.deepEqual(kinds(rig.intents), ["nextCell", "keep"]);
});

test("rotation reports do nothing by default and tilt pans when enabled", () => {
  const off = harness();
  off.feed(recorded.twist);
  assert.deepEqual(off.pans, []);
  const on = harness("review", true);
  on.feed(recorded.twist);
  assert.ok(on.pans.length > 0);
});

test("larger ranges widen the normalisation", () => {
  const rig = harness();
  rig.feed({ reportId: 1, data: triple(500, 0, 0) });
  rig.feed(recorded.tiltRight);
  const [big, small] = rig.pans.map((pan) => Math.abs(pan[0] ?? 0));
  assert.ok((small ?? 0) < (big ?? 0));
});

test("reset releases a held pull", () => {
  const rig = harness("read");
  rig.feed(recorded.fullPull);
  for (const raw of rig.reader.reset()) rig.input.push(raw, 16);
  assert.deepEqual(rig.intents.at(-1), { kind: "peek", held: false });
});

type Listener = (event: HidInputReportEvent) => void;

const fakeDevice = (vendorId = 0x256f) => {
  const listeners = new Set<Listener>();
  let opened = false;
  const device: HidDeviceLike = {
    vendorId,
    productId: 0xc626,
    get opened() {
      return opened;
    },
    collections: [{ usagePage: 1, usage: 8 }],
    open: () => {
      opened = true;
      return Promise.resolve();
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  const emit = (report: { reportId: number; data: DataView }) => {
    for (const listener of listeners) listener({ ...report, device });
  };
  return { device, emit, listeners };
};

const fakeHid = (granted: HidDeviceLike[], chooser: HidDeviceLike[] = []) => {
  const handlers = new Map<string, () => void>();
  const requests: unknown[] = [];
  const hid: HidLike = {
    getDevices: () => Promise.resolve(granted),
    requestDevice: (options) => {
      requests.push(options);
      return Promise.resolve(chooser);
    },
    addEventListener: (type, listener) => handlers.set(type, listener),
    removeEventListener: (type) => handlers.delete(type),
  };
  return { hid, handlers, requests };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a granted device streams reports into the camera and detaches on stop", async () => {
  const pans: number[][] = [];
  const input = createCameraInput({
    device: () => "spacemouse",
    context: () => "review",
    camera: { panBy: (dx, dy) => pans.push([dx, dy]), zoomBy: () => undefined },
  });
  const mouse = fakeDevice();
  const { hid } = fakeHid([mouse.device]);
  let now = 0;
  const stop = bindSpaceMouse(input, {
    hid,
    now: () => (now += 16),
    focused: () => true,
  });
  await settle();
  assert.equal(mouse.device.opened, true);
  mouse.emit(recorded.tiltRight);
  assert.equal(pans.length, 1);
  stop();
  assert.equal(mouse.listeners.size, 0);
});

test("reports are ignored while the window is unfocused", async () => {
  const pans: number[][] = [];
  const input = createCameraInput({
    device: () => "spacemouse",
    context: () => "review",
    camera: { panBy: (dx, dy) => pans.push([dx, dy]), zoomBy: () => undefined },
  });
  const mouse = fakeDevice();
  const { hid } = fakeHid([mouse.device]);
  const stop = bindSpaceMouse(input, { hid, now: () => 0, focused: () => false });
  await settle();
  mouse.emit(recorded.tiltRight);
  assert.deepEqual(pans, []);
  stop();
});

test("a device that is not a SpaceMouse is never attached", async () => {
  const input = createCameraInput({
    device: () => "spacemouse",
    context: () => "review",
    camera: { panBy: () => undefined, zoomBy: () => undefined },
  });
  const other = fakeDevice(0x1234);
  const { hid } = fakeHid([other.device]);
  const stop = bindSpaceMouse(input, { hid, now: () => 0, focused: () => true });
  await settle();
  assert.equal(other.listeners.size, 0);
  stop();
});

test("the permission prompt asks for 3Dconnexion devices and reports the outcome", async () => {
  const mouse = fakeDevice();
  const granted = fakeHid([], [mouse.device]);
  assert.equal(await requestSpaceMouse(granted.hid), "granted");
  assert.deepEqual(granted.requests, [
    {
      filters: [
        { vendorId: 0x256f, usagePage: 1, usage: 8 },
        { vendorId: 0x046d, usagePage: 1, usage: 8 },
      ],
    },
  ]);
  assert.equal(await requestSpaceMouse(fakeHid([], []).hid), "none");
  assert.equal(await requestSpaceMouse(undefined), "unsupported");
  const refused: HidLike = {
    ...fakeHid([]).hid,
    requestDevice: () => Promise.reject(new Error("NotAllowedError")),
  };
  assert.equal(await requestSpaceMouse(refused), "cancelled");
});

test("hasWebHid is false where navigator.hid is missing", () => {
  assert.equal(hasWebHid({}), false);
  assert.equal(hasWebHid(undefined), false);
  assert.equal(hasWebHid({ hid: {} }), true);
});
