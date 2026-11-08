import type { ListAuditEventsParams } from "@parfocal/api-client";

export type AuditPeriod = "today" | "week" | "month";

export type AuditFilter = {
  person?: string | undefined;
  project?: string | undefined;
  period?: AuditPeriod | undefined;
  group?: string | undefined;
};

export const defaultAuditFilter: AuditFilter = { period: "today" };

export const auditPeriods: { value: AuditPeriod; label: string; days: number }[] = [
  { value: "today", label: "Today", days: 0 },
  { value: "week", label: "Last 7 days", days: 6 },
  { value: "month", label: "Last 30 days", days: 29 },
];

export const auditGroups: { value: string; label: string }[] = [
  { value: "user.", label: "Sign-in" },
  { value: "member.", label: "People and roles" },
  { value: "invitation.", label: "Invitations" },
  { value: "project.", label: "Projects" },
  { value: "case.", label: "Cases" },
  { value: "slide.", label: "Slides" },
  { value: "task.", label: "Tasks" },
  { value: "review.", label: "Reviews" },
  { value: "tenant.", label: "Workspace and security" },
  { value: "api-token.", label: "API tokens" },
  { value: "audit.", label: "Audit exports" },
];

export function periodTitle(period: AuditPeriod | undefined): string {
  return auditPeriods.find((item) => item.value === period)?.label ?? "Any time";
}

export function auditParams(filter: AuditFilter, today: Date): ListAuditEventsParams {
  const params: ListAuditEventsParams = {};
  if (filter.person) params.person = filter.person;
  if (filter.project) params.project_id = filter.project;
  if (filter.group) params.action_prefix = filter.group;
  const period = auditPeriods.find((item) => item.value === filter.period);
  if (period) {
    const since = new Date(today.getFullYear(), today.getMonth(), today.getDate() - period.days);
    params.since = since.toISOString();
  }
  return params;
}

const auditLabels: Record<string, string> = {
  "user.signed-in": "Signed in",
  "user.signed-out": "Signed out",
  "user.sessions-ended": "Ended their sessions",
  "user.profile-changed": "Changed their profile",
  "member.added": "Added a member",
  "member.role-changed": "Changed a role",
  "member.admin-rights-given": "Gave admin rights",
  "member.admin-rights-removed": "Removed admin rights",
  "invitation.created": "Invited someone",
  "invitation.revoked": "Withdrew an invitation",
  "invitation.resent": "Sent an invitation again",
  "invitation.accepted": "Accepted an invitation",
  "tenant.settings-changed": "Changed the workspace settings",
  "tenant.session-policy-changed": "Changed the lock times",
  "tenant.security-contact-changed": "Changed the security contact",
  "project.created": "Created a project",
  "project.changed": "Changed a project",
  "project.privacy-changed": "Changed the privacy of a project",
  "project.archived": "Archived a project",
  "project.emergency-access": "Used emergency access",
  "case.created": "Created a case",
  "case.opened": "Opened a case",
  "case.patient-viewed": "Viewed patient details",
  "slide.opened": "Opened a slide",
  "slide.read-in-place": "Read a slide in place",
  "slide.restricted-image-viewed": "Viewed a restricted image",
  "task.created": "Created a task",
  "task.review-submitted": "Submitted a review",
  "task.signed-off": "Signed off a task",
  "task.reopened": "Reopened a task",
  "review.decision-set": "Set a decision",
  "review.decision-cleared": "Cleared a decision",
  "decision.changed-after-sign-off": "Changed a decision after sign-off",
  "audit.exported": "Exported the audit log",
  "service-account.created": "Created a service account",
  "api-token.issued": "Issued an API token",
  "api-token.revoked": "Revoked an API token",
  "webhook.rejected": "Rejected a call with a bad signature",
};

export function auditLabel(action: string): string {
  const known = auditLabels[action];
  if (known) return known;
  const area = (action.split(".")[0] ?? action).replaceAll("-", " ");
  return `${area.charAt(0).toUpperCase()}${area.slice(1)} event`;
}

export function auditFileName(at: Date): string {
  const day = [at.getFullYear(), at.getMonth() + 1, at.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
  return `parfocal-audit-${day}.json`;
}
