import assert from "node:assert/strict";
import { test } from "node:test";
import type { Me } from "@parfocal/api-client";
import { keyRegistry } from "../src/keys/catalogue.ts";
import { canUseDeveloperMode, wantsLab } from "../src/lab/developer-access.ts";

const meOf = (role: "researcher" | "reviewer", active = "a"): Me => ({
  user_id: "u",
  display_name: "Test Person",
  initials: "TP",
  avatar_colour: 0,
  title: "",
  email: "tp@example.org",
  specialties: [],
  active_tenant_id: active,
  workspaces: [
    {
      tenant_id: "a",
      role,
      admin_rights: false,
      slug: "a",
      name: "a",
      kind: "research",
      status: "active",
      organisation_name: "Lab",
      logo: "L",
      logo_colour: "#2f6fdf",
    },
  ],
});

test("a researcher gets the developer drawer", () => {
  assert.equal(canUseDeveloperMode(meOf("researcher")), true);
});

test("a doctor reviewing slides does not get the developer drawer", () => {
  assert.equal(canUseDeveloperMode(meOf("reviewer")), false);
});

test("nobody signed out and nobody outside the active workspace gets it", () => {
  assert.equal(canUseDeveloperMode(undefined), false);
  assert.equal(canUseDeveloperMode(meOf("researcher", "elsewhere")), false);
});

test("the lab flag is read from the address", () => {
  assert.equal(wantsLab("?lab"), true);
  assert.equal(wantsLab("?renderer=viv&lab=1"), true);
  assert.equal(wantsLab("?labs=1"), false);
  assert.equal(wantsLab(""), false);
});

test("the drawer opens with Ctrl+Shift+D", () => {
  const [binding] = keyRegistry.bindings({ scopes: ["global"], only: ["developer"] });
  assert.deepEqual(binding?.keys, ["⇧⌘D"]);
});
