import assert from "node:assert/strict";
import { test } from "node:test";
import type { Me } from "@parfocal/api-client";
import { permissionMatrix } from "../src/screens/admin/permission-matrix.generated.ts";
import {
  assignedTo,
  holdsReviewRight,
  lookOnlyLayer,
  type ViewerAccessFacts,
  viewerAccessOf,
  type WorkspaceRole,
  workspaceRoleOf,
} from "../src/viewer/viewer-access.ts";

const roles: readonly WorkspaceRole[] = ["researcher", "reviewer"];

const reviewRow = permissionMatrix.find((row) => row.key === "review");

const open: ViewerAccessFacts = {
  role: "reviewer",
  projectRole: "reviewer",
  taskKind: "review",
  assigned: true,
  withdrawn: false,
  signedOff: false,
};

test("the review right follows the review row of the permissions matrix", () => {
  assert.ok(reviewRow !== undefined);
  for (const role of roles) {
    const grant: string = reviewRow[role];
    assert.equal(holdsReviewRight(role), grant === "y" || grant === "o", role);
  }
});

test("every role with the review right edits an open slide assigned to them", () => {
  for (const role of roles) {
    const expected = holdsReviewRight(role)
      ? { kind: "edit" }
      : { kind: "read-only", reason: "no-review-right" };
    for (const taskKind of ["review", "annotate"] as const) {
      assert.deepEqual(
        viewerAccessOf({ ...open, role, taskKind }),
        expected,
        `${role} ${taskKind}`,
      );
    }
  }
});

test("own-task grants and full grants alike are read only on a slide assigned to others", () => {
  for (const role of roles) {
    if (!holdsReviewRight(role)) continue;
    for (const projectRole of ["owner", "reviewer"] as const) {
      assert.deepEqual(
        viewerAccessOf({ ...open, role, projectRole, assigned: false }),
        { kind: "read-only", reason: "not-assigned" },
        `${role} as project ${projectRole}`,
      );
    }
  }
});

const cases: readonly [string, Partial<ViewerAccessFacts>, string][] = [
  ["no task, a reviewer looks and measures", { taskKind: undefined, assigned: undefined }, "edit"],
  ["a project viewer", { projectRole: "viewer" }, "no-review-right"],
  [
    "a project viewer with no task",
    { projectRole: "viewer", taskKind: undefined },
    "no-review-right",
  ],
  ["a withdrawn review task", { withdrawn: true }, "withdrawn"],
  ["a withdrawn annotate task", { taskKind: "annotate", withdrawn: true }, "withdrawn"],
  ["withdrawn beats not assigned", { withdrawn: true, assigned: false }, "withdrawn"],
  ["a signed off review slide", { signedOff: true }, "signed-off"],
  ["not assigned beats signed off", { signedOff: true, assigned: false }, "not-assigned"],
  [
    "a signed off annotate slide for an expert",
    { taskKind: "annotate", signedOff: true },
    "signed-off",
  ],
  [
    "a signed off annotate slide for the owner, who amends",
    { taskKind: "annotate", signedOff: true, projectRole: "owner", assigned: false },
    "edit",
  ],
  [
    "a signed off review slide for the owner",
    { signedOff: true, projectRole: "owner", role: "researcher" },
    "signed-off",
  ],
  ["an unassigned annotate expert", { taskKind: "annotate", assigned: false }, "not-assigned"],
  [
    "an unassigned annotate owner on an open slide",
    { taskKind: "annotate", assigned: false, projectRole: "owner", role: "researcher" },
    "not-assigned",
  ],
  ["assignment not known yet", { assigned: undefined }, "edit"],
  ["role not known yet", { role: undefined }, "edit"],
];

for (const [name, change, expected] of cases) {
  test(`access for ${name}`, () => {
    const access = viewerAccessOf({ ...open, ...change });
    assert.equal(access.kind === "edit" ? "edit" : access.reason, expected);
  });
}

test("an annotate layer is look only for every read only reason but signed off", () => {
  const base = { ...open, taskKind: "annotate" as const };
  assert.equal(lookOnlyLayer(viewerAccessOf({ ...base, assigned: false })), true);
  assert.equal(lookOnlyLayer(viewerAccessOf({ ...base, withdrawn: true })), true);
  assert.equal(lookOnlyLayer(viewerAccessOf({ ...base, signedOff: true })), false);
  assert.equal(lookOnlyLayer(viewerAccessOf(base)), false);
});

test("the workspace role is the role in the active workspace", () => {
  const me = {
    active_tenant_id: "b",
    workspaces: [
      { tenant_id: "a", role: "reviewer" },
      { tenant_id: "b", role: "researcher" },
    ],
  } as unknown as Me;
  assert.equal(workspaceRoleOf(me), "researcher");
  assert.equal(workspaceRoleOf(undefined), undefined);
});

test("assignment reads the reviewers of the slide", () => {
  const slides = [{ slide_id: "s1", reviewer_ids: ["u1"] }];
  assert.equal(assignedTo(slides, "s1", "u1"), true);
  assert.equal(assignedTo(slides, "s1", "u2"), false);
  assert.equal(assignedTo(slides, "s2", "u1"), undefined);
  assert.equal(assignedTo(slides, "s1", undefined), undefined);
});
