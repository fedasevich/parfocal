import { permissionMatrix } from "./permission-matrix.generated.ts";

export type PermissionKey = (typeof permissionMatrix)[number]["key"];

export type GrantCode = "y" | "o" | "r" | "b" | "n";

export type PermissionColumn = "researcher" | "reviewer" | "adminRights";

export const permissionColumns: readonly PermissionColumn[] = [
  "researcher",
  "reviewer",
  "adminRights",
];

export type PermissionRow = {
  key: PermissionKey;
  grants: Record<PermissionColumn, GrantCode>;
};

export function permissionRows(): PermissionRow[] {
  return permissionMatrix.map((entry) => ({
    key: entry.key,
    grants: {
      researcher: entry.researcher,
      reviewer: entry.reviewer,
      adminRights: entry.adminRights ? "y" : "n",
    },
  }));
}
