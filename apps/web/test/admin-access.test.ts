import assert from "node:assert/strict";
import { test } from "node:test";
import type { Me } from "@parfocal/api-client";
import { adminAccessOf, canOpenAdmin, refusalOf } from "../src/screens/admin/admin-access.ts";

const workspace = (
  tenant: string,
  role: "researcher" | "reviewer",
  adminRights: boolean,
): Me["workspaces"][number] => ({
  tenant_id: tenant,
  role,
  admin_rights: adminRights,
  slug: tenant,
  name: tenant,
  kind: "research",
  status: "active",
  organisation_name: "Lab",
  logo: "L",
  logo_colour: "#2f6fdf",
});

const meWith = (...workspaces: Me["workspaces"]): Me => ({
  user_id: "u",
  display_name: "Test Person",
  initials: "TP",
  avatar_colour: 0,
  title: "",
  email: "tp@example.org",
  specialties: [],
  active_tenant_id: "a",
  workspaces,
});

test("a researcher with admin rights opens the admin page", () => {
  const me = meWith(workspace("a", "researcher", true));
  assert.equal(adminAccessOf(me), "granted");
  assert.equal(canOpenAdmin(me), true);
});

test("a researcher without admin rights is refused", () => {
  const me = meWith(workspace("a", "researcher", false));
  assert.equal(adminAccessOf(me), "researcher-without-rights");
  assert.equal(canOpenAdmin(me), false);
});

test("a reviewer is refused", () => {
  const me = meWith(workspace("a", "reviewer", false));
  assert.equal(adminAccessOf(me), "reviewer");
  assert.equal(canOpenAdmin(me), false);
});

test("admin rights in another workspace do not open this one", () => {
  const me = meWith(workspace("a", "researcher", false), workspace("b", "researcher", true));
  assert.equal(adminAccessOf(me), "researcher-without-rights");
});

test("a person who is not a member of the active workspace is refused", () => {
  const me = meWith(workspace("b", "researcher", true));
  assert.equal(canOpenAdmin(me), false);
});

test("nothing opens before the person is known", () => {
  assert.equal(canOpenAdmin(undefined), false);
});

test("each refusal says what the person can do next", () => {
  assert.match(refusalOf("reviewer").body, /Ask a researcher with admin rights/);
  assert.match(refusalOf("researcher-without-rights").body, /Ask a researcher who holds them/);
});
