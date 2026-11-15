import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  argmax,
  createLearnerClient,
  type LearnerReply,
  type LearnerRequest,
  type LearnerWorker,
  LearnerWorkerError,
  readSavedLearner,
  startLearnerWorker,
} from "../../src/index.ts";

type Listener = (event: { data: never }) => void;

function linkedWorker() {
  const toWorker: Listener[] = [];
  const toClient: Listener[] = [];
  const failures: ((event: Event) => void)[] = [];
  let clock = 0;
  const scope = {
    addEventListener: (_type: "message", listener: Listener) => toWorker.push(listener),
    postMessage: (message: LearnerReply) => {
      queueMicrotask(() => {
        for (const listener of toClient) listener({ data: message as never });
      });
    },
  };
  const worker = {
    addEventListener: (type: string, listener: Listener & ((event: Event) => void)) => {
      if (type === "message") toClient.push(listener);
      else failures.push(listener);
    },
    postMessage: (message: LearnerRequest) => {
      queueMicrotask(() => {
        for (const listener of toWorker) listener({ data: message as never });
      });
    },
    terminate: () => undefined,
  };
  startLearnerWorker(scope as never, {
    now: () => {
      clock += 3;
      return clock;
    },
  });
  return {
    worker: worker as unknown as LearnerWorker,
    fail: () => {
      for (const listener of failures) listener(new Event("error"));
    },
  };
}

const classKeys = ["tumor", "stroma"];

async function teachTwoClusters(client: ReturnType<typeof createLearnerClient>) {
  for (let i = 0; i < 12; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    await client.teach(
      `shape-${i}`,
      Float32Array.of(side * 2 + i * 0.01, 1),
      classKeys[i % 2] ?? "",
    );
  }
}

describe("the learner worker", () => {
  it("opens a slide, retrains on each correction and reports the time it took", async () => {
    const { worker } = linkedWorker();
    const client = createLearnerClient(() => worker);
    const opened = await client.open(2, classKeys, null);
    assert.deepEqual(opened, {
      status: { count: 0, ready: false, trained: false },
      restored: false,
    });
    const first = await client.teach("shape-a", Float32Array.of(1, 1), "tumor");
    assert.deepEqual(first.status, { count: 1, ready: false, trained: false });
    assert.equal(first.ms, 3);
    await teachTwoClusters(client);
    const forgot = await client.forget("shape-a");
    assert.deepEqual(forgot.status, { count: 12, ready: true, trained: true });
    const [left, right] = await client.predict([Float32Array.of(-2, 1), Float32Array.of(2, 1)]);
    assert.equal(argmax(left ?? []), 0);
    assert.equal(argmax(right ?? []), 1);
    client.close();
  });

  it("answers null for every shape before it is trained", async () => {
    const { worker } = linkedWorker();
    const client = createLearnerClient(() => worker);
    await client.open(2, classKeys, null);
    assert.deepEqual(await client.predict([Float32Array.of(0, 0)]), [null]);
    client.close();
  });

  it("saves the slide's learner and restores it when the slide opens again", async () => {
    const first = linkedWorker();
    const client = createLearnerClient(() => first.worker);
    await client.open(2, classKeys, null);
    await teachTwoClusters(client);
    const saved = readSavedLearner(JSON.parse(JSON.stringify(await client.save())));
    client.close();
    const second = linkedWorker();
    const reopened = createLearnerClient(() => second.worker);
    const opened = await reopened.open(2, classKeys, saved);
    assert.equal(opened.restored, true);
    assert.deepEqual(opened.status, { count: 12, ready: true, trained: true });
    const resized = await reopened.open(3, classKeys, saved);
    assert.equal(resized.restored, false);
    assert.equal(resized.status.count, 0);
    reopened.close();
  });

  it("rejects a correction to a class the slide does not have or before a slide is open", async () => {
    const { worker } = linkedWorker();
    const client = createLearnerClient(() => worker);
    await assert.rejects(client.teach("a", Float32Array.of(1, 1), "tumor"), LearnerWorkerError);
    await client.open(2, classKeys, null);
    await assert.rejects(client.teach("a", Float32Array.of(1, 1), "immune"), /immune/);
    await assert.rejects(client.teach("a", Float32Array.of(1), "tumor"), LearnerWorkerError);
    client.close();
  });

  it("rejects waiting and later requests when the worker stops or the client closes", async () => {
    const { worker, fail } = linkedWorker();
    const client = createLearnerClient(() => worker);
    const waiting = client.open(2, classKeys, null);
    fail();
    await assert.rejects(waiting, LearnerWorkerError);
    await assert.rejects(client.save(), LearnerWorkerError);
    const other = linkedWorker();
    const closing = createLearnerClient(() => other.worker);
    closing.close();
    await assert.rejects(closing.save(), /closed/);
  });
});
