import type {
  ClinicalTemplate,
  ProjectMember,
  ProjectRole,
  SignOutRight,
} from "@parfocal/api-client";

export const signOutOptions: { value: SignOutRight; label: string }[] = [
  { value: "own", label: "Own cases" },
  { value: "any", label: "Any case" },
  { value: "never", label: "Never" },
];

export const roleText: Record<ProjectRole, string> = {
  owner: "Owner",
  reviewer: "Reviewer",
  viewer: "Viewer",
};

export const clinicalTemplateOptions: { value: ClinicalTemplate; name: string; detail: string }[] =
  [
    { value: "sentinel-node", name: "Sentinel node report v2", detail: "With a staging step" },
    {
      value: "lymph-node-excision",
      name: "Lymph node excision report v1",
      detail: "No staging step",
    },
  ];

export const viewersCannotSignOut = "Viewers cannot sign out";

export const nobodySignsOutWarning =
  "Nobody could sign out in this project. Reports would all go for co-sign.";

export type SignOutRow = {
  userId: string;
  role: ProjectRole;
  right: SignOutRight;
  fixed: boolean;
};

export function signOutRows(members: ProjectMember[]): SignOutRow[] {
  return members.map((member) => ({
    userId: member.user_id,
    role: member.role,
    right: member.role === "viewer" ? "never" : (member.sign_out ?? "never"),
    fixed: member.role === "viewer",
  }));
}

export function withRight(rows: SignOutRow[], userId: string, right: SignOutRight): SignOutRow[] {
  return rows.map((row) => (row.userId === userId && !row.fixed ? { ...row, right } : row));
}

export function nobodySignsOut(rows: SignOutRow[]): boolean {
  return rows.every((row) => row.right === "never");
}

export const matchLimits = {
  iou: { min: 0.05, max: 1, step: 0.05 },
  distance: { min: 0.5, max: 50, step: 0.5 },
} as const;
