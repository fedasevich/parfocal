import assert from "node:assert/strict";
import { test } from "node:test";
import type { Invitation, MemberActivity } from "@parfocal/api-client";
import {
  adminSwitchOf,
  memberActionsOf,
  shownInvitations,
  takenEmails,
} from "../src/screens/admin/people-rules.ts";

const invitation = (email: string): Invitation => ({
  id: email,
  tenant_id: "t",
  email,
  role: "reviewer",
  admin_rights: false,
  created_at: "2026-10-15T09:30:00+02:00",
  expires_at: "2026-10-22T09:30:00+02:00",
  expired: false,
});

const activity = (email: string | null): MemberActivity => ({
  user_id: email ?? "none",
  email,
  last_active_at: null,
  project_codes: [],
  deactivates_on: null,
  deactivated_at: null,
});

test("the admin switch is absent on reviewers and locked for the last holder", () => {
  assert.equal(adminSwitchOf("reviewer", false, 1), "absent");
  assert.equal(adminSwitchOf("researcher", true, 1), "locked");
  assert.equal(adminSwitchOf("researcher", true, 2), "on");
  assert.equal(adminSwitchOf("researcher", false, 1), "off");
});

test("pending invites show under All and match the search", () => {
  const waiting = [invitation("ondrej@fnvltava.example"), invitation("karel@cuailab.example")];
  assert.equal(shownInvitations(waiting, "", "all").length, 2);
  assert.deepEqual(
    shownInvitations(waiting, " Karel ", "all").map((row) => row.email),
    ["karel@cuailab.example"],
  );
  assert.deepEqual(shownInvitations(waiting, "", "res"), []);
});

const person = {
  role: "researcher" as const,
  holdsRight: false,
  holders: 2,
  isViewer: false,
  deactivated: false,
  scheduled: false,
};

test("a menu offers only the actions the person can take", () => {
  assert.deepEqual(memberActionsOf(person), ["make-reviewer", "give-admin", "remove"]);
  assert.deepEqual(memberActionsOf({ ...person, holdsRight: true }), ["remove-admin", "remove"]);
  assert.deepEqual(memberActionsOf({ ...person, role: "reviewer" }), ["make-researcher", "remove"]);
  assert.deepEqual(memberActionsOf({ ...person, scheduled: true }), [
    "make-reviewer",
    "give-admin",
    "cancel-removal",
  ]);
});

test("the last holder, the viewer and a removed person lose the actions that would lock them out", () => {
  assert.deepEqual(memberActionsOf({ ...person, holdsRight: true, holders: 1 }), []);
  assert.deepEqual(memberActionsOf({ ...person, isViewer: true }), ["make-reviewer", "give-admin"]);
  assert.deepEqual(memberActionsOf({ ...person, deactivated: true }), []);
});

test("members and pending invites cannot be invited again", () => {
  assert.deepEqual(
    takenEmails([activity("Lenka@FN.example"), activity(null)], [invitation("eva@fn.example")]),
    ["lenka@fn.example", "eva@fn.example"],
  );
});
