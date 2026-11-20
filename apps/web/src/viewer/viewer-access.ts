import type { Me, ProjectRole, TaskKind } from "@parfocal/api-client";
import { permissionMatrix } from "../screens/admin/permission-matrix.generated.ts";

export type WorkspaceRole = "researcher" | "reviewer";

export type ReadOnlyReason = "no-review-right" | "withdrawn" | "not-assigned" | "signed-off";

export type ViewerAccess =
  | { readonly kind: "edit" }
  | { readonly kind: "read-only"; readonly reason: ReadOnlyReason };

export type ViewerAccessFacts = {
  readonly role: WorkspaceRole | undefined;
  readonly projectRole: ProjectRole | undefined;
  readonly taskKind: TaskKind | undefined;
  readonly assigned: boolean | undefined;
  readonly withdrawn: boolean;
  readonly signedOff: boolean;
};

export const editAccess: ViewerAccess = { kind: "edit" };

const readOnly = (reason: ReadOnlyReason): ViewerAccess => ({ kind: "read-only", reason });

const reviewGrants = permissionMatrix.find((row) => row.key === "review");

export function holdsReviewRight(role: WorkspaceRole): boolean {
  const grant = reviewGrants?.[role];
  return grant === "y" || grant === "o";
}

export function workspaceRoleOf(me: Me | undefined): WorkspaceRole | undefined {
  return me?.workspaces.find((item) => item.tenant_id === me.active_tenant_id)?.role;
}

export function viewerAccessOf(facts: ViewerAccessFacts): ViewerAccess {
  if (facts.role !== undefined && !holdsReviewRight(facts.role)) return readOnly("no-review-right");
  if (facts.projectRole === "viewer") return readOnly("no-review-right");
  if (facts.taskKind === undefined) return editAccess;
  if (facts.withdrawn) return readOnly("withdrawn");
  const owner = facts.projectRole === "owner";
  if (facts.taskKind === "annotate" && facts.signedOff && owner) return editAccess;
  if (facts.assigned === false) return readOnly("not-assigned");
  if (facts.signedOff) return readOnly("signed-off");
  return editAccess;
}

export function isReadOnly(access: ViewerAccess): boolean {
  return access.kind === "read-only";
}

const refusalCodes: Record<ReadOnlyReason, string> = {
  "no-review-right": "no-review-right",
  withdrawn: "task-withdrawn",
  "not-assigned": "not-assigned",
  "signed-off": "task-signed-off",
};

export function readOnlyCodeOf(access: ViewerAccess): string | undefined {
  return access.kind === "read-only" ? refusalCodes[access.reason] : undefined;
}

export function assignedTo(
  slides: readonly { readonly slide_id: string; readonly reviewer_ids: readonly string[] }[],
  slideId: string,
  me: string | undefined,
): boolean | undefined {
  if (me === undefined) return undefined;
  const entry = slides.find((slide) => slide.slide_id === slideId);
  return entry === undefined ? undefined : entry.reviewer_ids.includes(me);
}
