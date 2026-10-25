import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createTimeSlice, messageTasks, yieldToMain } from "../src/index.ts";
import { FakeTasks } from "./scheduling-fakes.ts";

const scope = globalThis as { scheduler?: unknown };

afterEach(() => {
  delete scope.scheduler;
});

test("message tasks run in the order they were posted and after the current task", async () => {
  const order: string[] = [];
  const done = new Promise<void>((resolve) => {
    messageTasks.run(() => order.push("first"));
    messageTasks.run(() => order.push("second"));
    messageTasks.run(() => {
      order.push("third");
      resolve();
    });
  });
  order.push("synchronous");
  await done;
  assert.deepEqual(order, ["synchronous", "first", "second", "third"]);
});

test("a cancelled message task does not run and the next one still does", async () => {
  const order: string[] = [];
  const cancel = messageTasks.run(() => order.push("cancelled"));
  const done = new Promise<void>((resolve) => {
    messageTasks.run(() => {
      order.push("kept");
      resolve();
    });
  });
  cancel();
  await done;
  assert.deepEqual(order, ["kept"]);
});

test("a task posted from a task runs after it", async () => {
  const order: string[] = [];
  await new Promise<void>((resolve) => {
    messageTasks.run(() => {
      order.push("outer");
      messageTasks.run(() => {
        order.push("inner");
        resolve();
      });
    });
  });
  assert.deepEqual(order, ["outer", "inner"]);
});

test("yieldToMain uses scheduler.yield when the browser has it", async () => {
  let calls = 0;
  scope.scheduler = {
    yield: () => {
      calls += 1;
      return Promise.resolve();
    },
  };
  await yieldToMain();
  assert.equal(calls, 1);
});

test("yieldToMain falls back to a task", async () => {
  const tasks = new FakeTasks();
  let resumed = false;
  const yielded = yieldToMain(tasks).then(() => {
    resumed = true;
  });
  await Promise.resolve();
  assert.equal(resumed, false);
  assert.equal(tasks.pending.size, 1);
  tasks.flush();
  await yielded;
  assert.equal(resumed, true);
});

test("a time slice yields once its budget is spent and then starts a new budget", async () => {
  let time = 0;
  let yields = 0;
  const slice = createTimeSlice(
    10,
    () => time,
    () => {
      yields += 1;
      return Promise.resolve();
    },
  );
  time = 9;
  assert.equal(await slice.checkpoint(), false);
  time = 10;
  assert.equal(await slice.checkpoint(), true);
  time = 15;
  assert.equal(await slice.checkpoint(), false);
  time = 20;
  assert.equal(await slice.checkpoint(), true);
  assert.equal(yields, 2);
});
