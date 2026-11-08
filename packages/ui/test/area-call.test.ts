import assert from "node:assert/strict";
import { test } from "node:test";
import {
  areaProgress,
  areaRole,
  type CallableArea,
  callOf,
  callToast,
  countOf,
  leadAreaId,
  pickCall,
  unsureAreaIds,
} from "../src/lib/area-call.ts";

const areas = (...calls: CallableArea["call"][]): CallableArea[] =>
  calls.map((call, index) => ({ id: `T${index + 1}`, call }));

test("the three calls map onto the decision values and back", () => {
  assert.equal(countOf("tumor"), "agree");
  assert.equal(countOf("not"), "disagree");
  assert.equal(countOf("unsure"), "unsure");
  assert.equal(callOf("agree"), "tumor");
  assert.equal(callOf("disagree"), "not");
  assert.equal(callOf("unsure"), "unsure");
  assert.equal(callOf(undefined), null);
});

test("picking the same call again toggles it off", () => {
  assert.equal(pickCall(null, "tumor"), "tumor");
  assert.equal(pickCall("tumor", "tumor"), null);
  assert.equal(pickCall("tumor", "not"), "not");
  assert.equal(pickCall("unsure", "unsure"), null);
});

test("tumor and not tumor tick the area and unsure keeps it open", () => {
  assert.deepEqual(areaProgress(areas("tumor", "not", "unsure", null)), { done: 2, total: 4 });
  assert.deepEqual(unsureAreaIds(areas("tumor", "unsure", null, "unsure")), ["T2", "T4"]);
  assert.deepEqual(areaProgress(areas("tumor", null)), { done: 1, total: 2 });
});

test("the largest area sets the category until it is marked not tumor", () => {
  assert.equal(leadAreaId(areas(null, null)), "T1");
  assert.equal(leadAreaId(areas("not", null, null)), "T2");
  assert.equal(leadAreaId(areas("not", "not")), null);
  assert.equal(areaRole(areas("not", null, null), "T2"), "sets");
  assert.equal(areaRole(areas("not", null, null), "T3"), "cannot");
  assert.equal(areaRole(areas("not", null), "T1"), "dropped");
});

test("an unsure lead area still sets the category", () => {
  assert.equal(leadAreaId(areas("unsure", "tumor")), "T1");
});

test("the toast names the next largest area when the lead is marked not tumor", () => {
  assert.match(callToast(areas(null, null), "T1", "not"), /T2 now sets the category/);
  assert.doesNotMatch(callToast(areas(null, null), "T2", "not"), /sets the category/);
  assert.match(callToast(areas(null), "T1", "tumor"), /confirmed by you/);
  assert.match(callToast(areas(null), "T1", "unsure"), /stays open/);
  assert.match(callToast(areas("tumor"), "T1", null), /removed/);
});
