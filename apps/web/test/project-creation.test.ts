import assert from "node:assert/strict";
import { test } from "node:test";
import type { Me, Role } from "@parfocal/api-client";
import { canOpenAdmin } from "../src/screens/admin/admin-access.ts";
import { canCreateProjects } from "../src/shell/project-creation.ts";

const meAs = (role: Role, adminRights = false): Me =>
  ({
    active_tenant_id: "t1",
    workspaces: [
      { tenant_id: "t0", role: "researcher", admin_rights: true },
      { tenant_id: "t1", role, admin_rights: adminRights },
    ],
  }) as unknown as Me;

test("a study participant seat neither creates projects nor opens Admin", () => {
  assert.equal(canCreateProjects(meAs("study-participant")), false);
  assert.equal(canOpenAdmin(meAs("study-participant")), false);
});

test("researchers and reviewers keep New project as before", () => {
  assert.equal(canCreateProjects(meAs("researcher")), true);
  assert.equal(canCreateProjects(meAs("reviewer")), true);
  assert.equal(canCreateProjects(undefined), true);
});
