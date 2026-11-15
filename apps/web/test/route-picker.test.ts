import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type EngineRouteId,
  pickRoutes,
  type RouteSwitchable,
} from "../src/viewer/route-picker.ts";

class FakeViewport implements RouteSwitchable {
  shown: EngineRouteId = "viv";
  available: EngineRouteId[] = ["viv", "deck-webgpu"];
  refuse: Error | null = null;
  switches: EngineRouteId[] = [];

  shownRoute = () => this.shown;
  availableRoutes = () => this.available;
  switchRoute = async (id: EngineRouteId) => {
    this.switches.push(id);
    await Promise.resolve();
    if (this.refuse !== null) throw this.refuse;
    this.shown = id;
    return "switched";
  };
}

function fakeSource(initial: EngineRouteId) {
  let wanted = initial;
  const listeners = new Set<() => void>();
  return {
    source: {
      wanted: () => wanted,
      subscribe: (notify: () => void) => {
        listeners.add(notify);
        return () => listeners.delete(notify);
      },
    },
    set: (next: EngineRouteId) => {
      wanted = next;
      for (const notify of listeners) notify();
    },
    listeners,
  };
}

test("the picker shows the wanted route once the slide is open and follows later changes", async () => {
  const viewport = new FakeViewport();
  const setting = fakeSource("deck-webgpu");
  const shown: [EngineRouteId, Error | null][] = [];
  const picker = pickRoutes({
    viewport,
    source: setting.source,
    onShown: (route, refused) => shown.push([route, refused]),
  });
  await picker.settled;
  assert.equal(viewport.shown, "deck-webgpu");
  setting.set("viv");
  await picker.fallBack(new Error("unused"));
  setting.set("deck-webgpu");
  setting.set("viv");
  setting.set("deck-webgpu");
  await picker.fallBack(new Error("unused"));
  assert.equal(viewport.shown, "viv");
  assert.deepEqual(viewport.switches, ["deck-webgpu", "viv", "deck-webgpu", "viv"]);
  assert.deepEqual(
    shown.map(([route]) => route),
    ["deck-webgpu", "viv", "deck-webgpu", "viv"],
  );
  picker.dispose();
  assert.equal(setting.listeners.size, 0);
});

test("the picker keeps Viv for the primary choice and for a route that is not registered", async () => {
  const viewport = new FakeViewport();
  const shown: EngineRouteId[] = [];
  const viv = pickRoutes({
    viewport,
    source: fakeSource("viv").source,
    onShown: (route) => shown.push(route),
  });
  await viv.settled;
  viv.dispose();
  const custom = pickRoutes({
    viewport,
    source: fakeSource("custom-webgpu").source,
    onShown: (route) => shown.push(route),
  });
  await custom.settled;
  custom.dispose();
  assert.equal(viewport.shown, "viv");
  assert.deepEqual(viewport.switches, []);
  assert.deepEqual(shown, []);
});

test("a refused switch leaves Viv showing and reports the reason", async () => {
  const viewport = new FakeViewport();
  viewport.refuse = new Error("No WebGPU adapter");
  const shown: [EngineRouteId, string | null][] = [];
  const picker = pickRoutes({
    viewport,
    source: fakeSource("deck-webgpu").source,
    onShown: (route, refused) => shown.push([route, refused?.message ?? null]),
  });
  await picker.settled;
  assert.equal(viewport.shown, "viv");
  assert.deepEqual(shown, [["viv", "No WebGPU adapter"]]);
  picker.dispose();
});

test("a failing alternate route falls back to Viv, says why and is not retried by other settings", async () => {
  const viewport = new FakeViewport();
  const shown: [EngineRouteId, string | null][] = [];
  const setting = fakeSource("deck-webgpu");
  const picker = pickRoutes({
    viewport,
    source: setting.source,
    onShown: (route, refused) => shown.push([route, refused?.message ?? null]),
  });
  await picker.settled;
  await picker.fallBack(new Error("device lost"));
  setting.set("deck-webgpu");
  await picker.fallBack(new Error("unused"));
  assert.equal(viewport.shown, "viv");
  assert.deepEqual(viewport.switches, ["deck-webgpu", "viv"]);
  assert.deepEqual(shown, [
    ["deck-webgpu", null],
    ["viv", "device lost"],
  ]);
  picker.dispose();
});

test("nothing is reported after the picker is disposed", async () => {
  const viewport = new FakeViewport();
  const shown: EngineRouteId[] = [];
  const picker = pickRoutes({
    viewport,
    source: fakeSource("deck-webgpu").source,
    onShown: (route) => shown.push(route),
  });
  picker.dispose();
  await picker.settled;
  assert.deepEqual(shown, []);
});
