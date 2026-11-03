import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createTransitions,
  cutEvents,
  routeTransition,
  stageName,
  type TransitionHost,
  targetWaitMs,
} from "../src/shell/view-transitions.ts";

type Listener = (event: { type: string }) => void;

class FakeElement {
  style = { viewTransitionName: "" };
  readonly attrs: Record<string, string>;
  readonly parent: FakeElement | null;
  constructor(attrs: Record<string, string>, parent: FakeElement | null = null) {
    this.attrs = attrs;
    this.parent = parent;
  }
  matches(selector: string) {
    const name = /\[([a-z-]+)/.exec(selector)?.[1] ?? "";
    const selected = selector.includes('[aria-selected="true"]');
    return name in this.attrs && (!selected || this.attrs["aria-selected"] === "true");
  }
  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) return this;
    return this.parent?.closest(selector) ?? null;
  }
}

function fakeHost({ reduced = false, motion = null as string | null, native = true } = {}) {
  const attrs = new Map<string, string>();
  if (motion !== null) attrs.set("data-motion", motion);
  const listeners = new Map<string, Listener[]>();
  const elements: FakeElement[] = [];
  const started: { skipped: boolean; done: Promise<void>; finish: () => void }[] = [];
  const host: TransitionHost & { active: FakeElement | null } = {
    active: null,
    get activeElement() {
      return this.active;
    },
    documentElement: {
      getAttribute: (name) => attrs.get(name) ?? null,
      setAttribute: (name, value) => void attrs.set(name, value),
      removeAttribute: (name) => void attrs.delete(name),
    },
    defaultView: { matchMedia: () => ({ matches: reduced }) },
    querySelector: (selector) => elements.find((element) => element.matches(selector)) ?? null,
    addEventListener: (type, listener) =>
      void listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    removeEventListener: (type, listener) =>
      void listeners.set(
        type,
        (listeners.get(type) ?? []).filter((item) => item !== listener),
      ),
  };
  if (native) {
    host.startViewTransition = (update) => {
      let finish: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const done = Promise.resolve().then(update);
      const entry = { skipped: false, done, finish };
      started.push(entry);
      return {
        ready: done,
        finished,
        updateCallbackDone: done,
        skipTransition: () => {
          entry.skipped = true;
          finish();
        },
      };
    };
  }
  const press = (type: string) => {
    for (const listener of listeners.get(type) ?? []) listener({ type });
  };
  return { host, attrs, elements, started, press, listeners };
}

test("My work to a slide opens, and back to My work returns", () => {
  assert.equal(routeTransition("/my-work", "/tasks/t1/guided"), "open");
  assert.equal(routeTransition("/my-work", "/tasks/t1/cells"), "open");
  assert.equal(routeTransition("/my-work", "/projects/p1/slides/s1"), "open");
  assert.equal(routeTransition("/tasks/t1/submitted", "/my-work"), "back");
  assert.equal(routeTransition("/tasks/t1/guided", "/my-work"), "back");
  assert.equal(routeTransition("/my-work", "/team"), null);
  assert.equal(routeTransition("/settings/profile", "/my-work"), null);
  assert.equal(routeTransition(undefined, "/tasks/t1/guided"), null);
});

test("the clicked row grows into the stage and both names clear at the end", async () => {
  const fake = fakeHost();
  const row = new FakeElement({ "data-vt-source": "" });
  fake.host.active = new FakeElement({}, row);
  const stage = new FakeElement({ "data-vt-target": "" });
  const transitions = createTransitions(fake.host);
  let namesAtUpdate = "";
  await transitions.run(() => {
    namesAtUpdate = row.style.viewTransitionName;
    fake.elements.push(stage);
  }, "open");
  assert.equal(namesAtUpdate, "");
  assert.equal(stage.style.viewTransitionName, stageName);
  assert.equal(fake.attrs.get("data-vt"), "open");
  assert.ok(transitions.active());
  fake.started[0]?.finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(stage.style.viewTransitionName, "");
  assert.equal(fake.attrs.has("data-vt"), false);
  assert.equal(transitions.active(), false);
});

test("a stage that renders a moment after the route update still gets the name", async () => {
  const fake = fakeHost();
  const stage = new FakeElement({ "data-vt-target": "" });
  const transitions = createTransitions(fake.host);
  await transitions.run(() => {
    setTimeout(() => fake.elements.push(stage), 25);
  }, "open");
  assert.equal(stage.style.viewTransitionName, stageName);
});

test("a stage that never renders leaves the move without a target", async () => {
  const fake = fakeHost();
  const transitions = createTransitions(fake.host);
  const started = Date.now();
  await transitions.run(() => undefined, "open");
  assert.ok(Date.now() - started >= targetWaitMs - 20);
  assert.equal(fake.attrs.get("data-vt"), "open");
});

test("the selected row is the source when focus sits elsewhere", async () => {
  const fake = fakeHost();
  const row = new FakeElement({ "data-vt-source": "", "aria-selected": "true" });
  fake.elements.push(row);
  const transitions = createTransitions(fake.host);
  let nameBefore = "";
  const original = fake.host.startViewTransition;
  fake.host.startViewTransition = (update) => {
    nameBefore = row.style.viewTransitionName;
    return original?.(update) as ReturnType<NonNullable<typeof original>>;
  };
  await transitions.run(() => undefined, "open");
  assert.equal(nameBefore, stageName);
});

test("a key press cuts the running transition and still reaches the app", async () => {
  const fake = fakeHost();
  const transitions = createTransitions(fake.host);
  const stop = transitions.listen();
  for (const type of cutEvents) assert.equal(fake.listeners.get(type)?.length, 1);
  let applied = false;
  await transitions.run(() => {
    applied = true;
  }, "focus");
  assert.ok(transitions.active());
  let appSaw = false;
  fake.listeners.set("keydown", [
    ...(fake.listeners.get("keydown") ?? []),
    () => {
      appSaw = true;
    },
  ]);
  fake.press("keydown");
  assert.ok(fake.started[0]?.skipped);
  assert.ok(applied);
  assert.ok(appSaw);
  assert.equal(transitions.active(), false);
  assert.equal(fake.attrs.has("data-vt"), false);
  stop();
  assert.equal(fake.listeners.get("pointerdown")?.length, 0);
});

test("run resolves once the page has changed, without waiting for the animation", async () => {
  const fake = fakeHost();
  const transitions = createTransitions(fake.host);
  let applied = false;
  await transitions.run(() => {
    applied = true;
  }, "open");
  assert.ok(applied);
  assert.ok(transitions.active());
});

test("a new transition cuts the one before it", async () => {
  const fake = fakeHost();
  const stage = new FakeElement({ "data-vt-target": "" });
  fake.elements.push(stage);
  const transitions = createTransitions(fake.host);
  await transitions.run(() => undefined, "focus");
  assert.equal(stage.style.viewTransitionName, stageName);
  let nameAtStart = "unset";
  const original = fake.host.startViewTransition;
  fake.host.startViewTransition = (update) => {
    nameAtStart = stage.style.viewTransitionName;
    return original?.(update) as ReturnType<NonNullable<typeof original>>;
  };
  await transitions.run(() => undefined, "focus");
  assert.ok(fake.started[0]?.skipped);
  assert.equal(nameAtStart, "");
});

for (const [label, options] of [
  ["the reduced motion query", { reduced: true }],
  ["the reduced motion setting", { motion: "reduced" }],
  ["a browser without view transitions", { native: false }],
] as const) {
  test(`${label} makes the change a cut`, async () => {
    const fake = fakeHost(options);
    const transitions = createTransitions(fake.host);
    let applied = false;
    await transitions.run(() => {
      applied = true;
    }, "open");
    assert.ok(applied);
    assert.equal(fake.started.length, 0);
    assert.equal(transitions.active(), false);
  });
}

test("presenting mode keeps the transition", async () => {
  const fake = fakeHost({ motion: "presenting" });
  await createTransitions(fake.host).run(() => undefined, "open");
  assert.equal(fake.started.length, 1);
});

test("a change with no transition kind runs straight away", async () => {
  const fake = fakeHost();
  await createTransitions(fake.host).run(() => undefined, null);
  assert.equal(fake.started.length, 0);
});

const css = readFileSync(
  new URL("../../../packages/tokens/src/tokens.css", import.meta.url),
  "utf8",
);

const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, selector);
  return css.slice(start, css.indexOf("}", start));
};

test("the transition overlay never takes the pointer", () => {
  assert.match(block("::view-transition"), /pointer-events: none;/);
});

test("transition timing comes from the motion tokens", () => {
  assert.match(block("::view-transition-group(stage)"), /var\(--motion-slower\)/);
  assert.match(block("::view-transition-group(stage)"), /var\(--motion-ease-in-out\)/);
  assert.match(block("::view-transition-group(*)"), /var\(--motion-slow\)/);
  const rules = css.slice(
    css.indexOf("::view-transition {"),
    css.indexOf("@media (prefers-reduced-motion: reduce)"),
  );
  assert.doesNotMatch(rules, /animation-duration: \d/);
});

test("the reduced motion setting cuts view transitions as the query does", () => {
  assert.match(block(':root[data-motion="reduced"]::view-transition-new(*)'), /animation: none/);
  const media = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(media.includes("::view-transition-group(*)"));
});
