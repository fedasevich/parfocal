import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLearnerClient,
  type LearnerReply,
  type LearnerRequest,
  type LearnerWorker,
  startLearnerWorker,
} from "@parfocal/viewer-engine";
import {
  changedCellIds,
  createSlideLearner,
  type LearnerCell,
  type LearnerInput,
  learnerClassKeys,
  retypedCells,
} from "../src/screens/viewer/slide-learner.ts";

type Listener = (event: { data: never }) => void;

function linkedWorker(): LearnerWorker {
  const toWorker: Listener[] = [];
  const toClient: Listener[] = [];
  const scope = {
    addEventListener: (_type: "message", listener: Listener) => toWorker.push(listener),
    postMessage: (message: LearnerReply) => {
      queueMicrotask(() => {
        for (const listener of toClient) listener({ data: message as never });
      });
    },
  };
  const worker = {
    addEventListener: (type: string, listener: Listener) => {
      if (type === "message") toClient.push(listener);
    },
    postMessage: (message: LearnerRequest) => {
      queueMicrotask(() => {
        for (const listener of toWorker) listener({ data: message as never });
      });
    },
    terminate: () => undefined,
  };
  startLearnerWorker(scope as never);
  return worker as unknown as LearnerWorker;
}

const cellCount = 48;

const truthOf = (index: number) => learnerClassKeys[index % 4] ?? "Tumor";

const cells: LearnerCell[] = Array.from({ length: cellCount }, (_, index) => ({
  object: `C${index}`,
  class_name: "Tumor",
  other_class: "Immune",
  score: 0.55,
}));

function pooledFeatureOf(cell: LearnerCell): Float32Array {
  const index = Number(cell.object.slice(1));
  const label = learnerClassKeys.indexOf(truthOf(index));
  const seed = Math.sin(index * 12.9898) * 43758.5453;
  return Float32Array.from(
    { length: 8 },
    (_, d) => (d === label ? 3 : 0) + ((seed * (d + 1)) % 1) * 0.2,
  );
}

function person(count: number, from = 0) {
  const labels = new Map<string, string>();
  const decided = new Set<string>();
  for (let index = from; index < from + count; index++) {
    labels.set(`C${index}`, truthOf(index));
    decided.add(`C${index}`);
  }
  return { labels, decided };
}

function inputOf(labels: Map<string, string>, decided: Set<string>): LearnerInput {
  return { cells, labels, decided: (object) => decided.has(object) };
}

function fresh() {
  return createSlideLearner({ client: createLearnerClient(() => linkedWorker()), pooledFeatureOf });
}

describe("the per-slide learner in the viewer", () => {
  it("shows no changed cells before the set number of corrections", async () => {
    const learner = fresh();
    const nine = person(12);
    await learner.update(inputOf(nine.labels, nine.decided));
    assert.equal(learner.view().corrections, 9);
    assert.equal(learner.view().changes.size, 0);
    const ten = person(14);
    await learner.update(inputOf(ten.labels, ten.decided));
    assert.equal(learner.view().corrections, 10);
    assert.ok(learner.view().changes.size > 0);
    learner.close();
  });

  it("changes undecided cells after the set number and never a decided one", async () => {
    const learner = fresh();
    const { labels, decided } = person(16);
    decided.add("C20");
    await learner.update(inputOf(labels, decided));
    const view = learner.view();
    assert.ok(view.corrections >= 10);
    assert.ok(view.changes.size > 5);
    for (const object of view.changes.keys()) assert.ok(!decided.has(object), object);
    assert.equal(view.changes.has("C20"), false);
    const right = [...view.changes].filter(
      ([object, change]) => change.to === truthOf(Number(object.slice(1))),
    );
    assert.ok(right.length / view.changes.size > 0.8);
    assert.deepEqual(changedCellIds(view.changes).sort(), [...view.changes.keys()].sort());
    learner.close();
  });

  it("retypes a changed cell to the learner's call and keeps the typer's call as the other", async () => {
    const learner = fresh();
    const { labels, decided } = person(16);
    await learner.update(inputOf(labels, decided));
    const [first] = [...learner.view().changes];
    assert.ok(first);
    const [object, change] = first;
    const retyped = retypedCells(cells, learner.view().changes).find(
      (cell) => cell.object === object,
    );
    assert.equal(retyped?.class_name, change.to);
    assert.equal(retyped?.other_class, "Tumor");
    learner.close();
  });

  it("freezes a change once the person reviews it", async () => {
    const learner = fresh();
    const { labels, decided } = person(16);
    await learner.update(inputOf(labels, decided));
    const [object, change] = [...learner.view().changes][0] ?? [];
    assert.ok(object && change);
    const next = new Map(labels).set(object, change.to);
    await learner.update(inputOf(next, new Set([...decided, object])));
    assert.deepEqual(learner.view().changes.get(object), change);
    learner.close();
  });

  it("keeps the zone as it is until another set number of corrections", async () => {
    const learner = fresh();
    const first = person(16);
    await learner.update(inputOf(first.labels, first.decided));
    const before = [...learner.view().changes.keys()].sort();
    const more = person(20);
    await learner.update(inputOf(more.labels, more.decided));
    const after = [...learner.view().changes.keys()].sort();
    assert.deepEqual(after, before);
    learner.close();
  });

  it("undoes every change and keeps the person's corrections", async () => {
    const learner = fresh();
    const { labels, decided } = person(16);
    await learner.update(inputOf(labels, decided));
    const [object, change] = [...learner.view().changes][0] ?? [];
    assert.ok(object && change);
    const next = new Map(labels).set(object, change.to);
    const reviewed = new Set([...decided, object]);
    await learner.update(inputOf(next, reviewed));
    learner.undoAll();
    const view = learner.view();
    assert.deepEqual(changedCellIds(view.changes), []);
    assert.deepEqual([...view.changes.keys()], [object]);
    const back = retypedCells(cells, view.changes);
    assert.equal(back.filter((cell) => cell.class_name !== "Tumor").length, 1);
    assert.equal(view.examples, 17);
    await learner.update(inputOf(next, reviewed));
    assert.deepEqual(changedCellIds(learner.view().changes), []);
    learner.close();
  });

  it("looks again after another set number of corrections once undone", async () => {
    const learner = fresh();
    const first = person(16);
    await learner.update(inputOf(first.labels, first.decided));
    learner.undoAll();
    const more = person(30);
    await learner.update(inputOf(more.labels, more.decided));
    assert.ok(learner.view().corrections >= 22);
    assert.ok(changedCellIds(learner.view().changes).length > 0);
    learner.close();
  });

  it("forgets what it learned and does not relearn the old corrections", async () => {
    const learner = fresh();
    const { labels, decided } = person(16);
    await learner.update(inputOf(labels, decided));
    assert.ok(learner.view().examples > 0);
    await learner.forget();
    assert.equal(learner.view().examples, 0);
    assert.deepEqual(changedCellIds(learner.view().changes), []);
    await learner.update(inputOf(labels, decided));
    assert.equal(learner.view().examples, 0);
    assert.equal(learner.view().changes.size, 0);
    const later = new Map(labels).set("C40", truthOf(40));
    await learner.update(inputOf(later, new Set([...decided, "C40"])));
    assert.equal(learner.view().examples, 1);
    learner.close();
  });

  it("stops teaching a shape when its decision is taken back", async () => {
    const learner = fresh();
    const { labels, decided } = person(16);
    await learner.update(inputOf(labels, decided));
    const smaller = new Map(labels);
    smaller.delete("C0");
    await learner.update(inputOf(smaller, new Set([...decided].filter((id) => id !== "C0"))));
    assert.equal(learner.view().examples, 15);
    learner.close();
  });
});
