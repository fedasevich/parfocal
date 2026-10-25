import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { observePixelRatio } from "../src/viv/canvas-observers.ts";

interface FakeQuery {
  readonly media: string;
  readonly listeners: Set<() => void>;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

const scope = globalThis as { matchMedia?: unknown; devicePixelRatio?: unknown };

function install(ratio: number) {
  const queries: FakeQuery[] = [];
  scope.devicePixelRatio = ratio;
  scope.matchMedia = (media: string): FakeQuery => {
    const query: FakeQuery = {
      media,
      listeners: new Set(),
      addEventListener: (_type, listener) => {
        query.listeners.add(listener);
      },
      removeEventListener: (_type, listener) => {
        query.listeners.delete(listener);
      },
    };
    queries.push(query);
    return query;
  };
  return {
    queries,
    move: (next: number) => {
      scope.devicePixelRatio = next;
      const current = queries.at(-1);
      if (!current) throw new Error("No query is armed");
      for (const listener of [...current.listeners]) listener();
    },
  };
}

afterEach(() => {
  delete scope.matchMedia;
  delete scope.devicePixelRatio;
});

test("a pixel ratio change is reported and the next change is watched under the new ratio", () => {
  const screen = install(1);
  let changes = 0;
  observePixelRatio(() => {
    changes += 1;
  });
  assert.equal(screen.queries.at(-1)?.media, "(resolution: 1dppx)");
  screen.move(2);
  assert.equal(changes, 1);
  assert.equal(screen.queries.at(-1)?.media, "(resolution: 2dppx)");
  screen.move(1.5);
  assert.equal(changes, 2);
});

test("stopping the observer removes its listener", () => {
  const screen = install(1);
  const stop = observePixelRatio(() => {});
  const armed = screen.queries.at(-1);
  assert.equal(armed?.listeners.size, 1);
  stop();
  assert.equal(armed?.listeners.size, 0);
});

test("without matchMedia the observer does nothing", () => {
  const stop = observePixelRatio(() => {});
  stop();
});
