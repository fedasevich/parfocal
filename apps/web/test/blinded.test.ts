import assert from "node:assert/strict";
import { test } from "node:test";
import type { RoomSignal } from "@parfocal/edge/room-client";
import {
  type BlindedFacts,
  blindedOn,
  hearUnlessBlinded,
  sendUnlessBlinded,
} from "../src/presence/blinded.ts";
import { stopFrame, viewFrame } from "../src/presence/follow-view.ts";
import { cursorFrame, goneFrame } from "../src/presence/shared-cursor.ts";

const task = {
  blinded: true,
  ai_hidden_first_read: false,
  slides: [{ slide_id: "s1", reviewer_ids: ["lenka", "sara"] }],
};

const facts: BlindedFacts = {
  taskId: "t1",
  slideId: "s1",
  me: "lenka",
  task,
  firstReadRecorded: false,
  myState: "in-review",
};

test("a reviewer who has not submitted a slide of a blinded task is blinded on it", () => {
  assert.equal(blindedOn(facts), true);
  assert.equal(blindedOn({ ...facts, myState: "assigned" }), true);
  assert.equal(blindedOn({ ...facts, myState: undefined }), true);
});

test("submitting the slide lifts the blinding", () => {
  for (const myState of ["submitted", "disagreement-queue", "signed-off", "exported"]) {
    assert.equal(blindedOn({ ...facts, myState }), false);
  }
});

test("a person outside the task, off the slide or in an open task is not blinded", () => {
  assert.equal(blindedOn({ ...facts, taskId: undefined, task: undefined }), false);
  assert.equal(blindedOn({ ...facts, me: "owner" }), false);
  assert.equal(blindedOn({ ...facts, slideId: "s2" }), false);
  assert.equal(blindedOn({ ...facts, task: { ...task, blinded: false } }), false);
});

test("an unrecorded first read blinds the reader even in an open task", () => {
  const hidden = { ...task, blinded: false, ai_hidden_first_read: true };
  assert.equal(blindedOn({ ...facts, task: hidden }), true);
  assert.equal(blindedOn({ ...facts, task: hidden, firstReadRecorded: true }), false);
  assert.equal(blindedOn({ ...facts, task: hidden, me: "owner" }), false);
});

test("the reader counts as blinded while the task or the person is still loading", () => {
  assert.equal(blindedOn({ ...facts, task: undefined }), true);
  assert.equal(blindedOn({ ...facts, me: undefined }), true);
});

test("a blinded reader sends no camera or cursor frame, only the frames that end sharing", () => {
  const sent: RoomSignal[] = [];
  let blinded = true;
  const send = sendUnlessBlinded(
    () => blinded,
    (signal) => {
      sent.push(signal);
      return true;
    },
  );
  assert.equal(send(viewFrame({ x: 1, y: 2, zoom: 3 })), false);
  assert.equal(send(cursorFrame({ x: 0.5, y: 0.5 })), false);
  assert.equal(send(stopFrame), true);
  assert.equal(send(goneFrame), true);
  assert.deepEqual(sent, [stopFrame, goneFrame]);
  blinded = false;
  assert.equal(send(cursorFrame({ x: 0.5, y: 0.5 })), true);
  assert.equal(sent.length, 3);
});

test("a blinded reader applies no shared frame", () => {
  const heard: RoomSignal[] = [];
  let blinded = true;
  const hear = hearUnlessBlinded(
    () => blinded,
    (signal) => heard.push(signal),
  );
  hear({ ...viewFrame({ x: 1, y: 2, zoom: 3 }), user: "sara" });
  hear({ ...cursorFrame({ x: 0.5, y: 0.5 }), user: "sara" });
  assert.equal(heard.length, 0);
  blinded = false;
  hear({ ...cursorFrame({ x: 0.5, y: 0.5 }), user: "sara" });
  assert.equal(heard.length, 1);
});
