import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewersOf } from "../src/screens/project/slide-reviews.ts";

test("one person with several tasks on a slide shows once with a count and the furthest state", () => {
  const rows = reviewersOf([
    { task_code: "RT-1", user_id: "ana", state: "assigned" },
    { task_code: "RT-2", user_id: "ana", state: "assigned" },
    { task_code: "RT-3", user_id: "ana", state: "submitted" },
    { task_code: "RT-3", user_id: "ben", state: "in-review" },
  ]);
  assert.deepEqual(rows, [
    { user_id: "ana", state: "submitted", tasks: 3 },
    { user_id: "ben", state: "in-review", tasks: 1 },
  ]);
});
