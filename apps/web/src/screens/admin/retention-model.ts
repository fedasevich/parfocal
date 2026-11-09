import type { RetentionPolicy } from "@parfocal/api-client";

export type RetentionKey = keyof RetentionPolicy;

export const KEEP = "keep";

export const deletedChoices = [7, 30, 90, 180, 365];
export const auditChoices = [365, 730, 1825, 3650];

export const retentionDays = (policy: RetentionPolicy, key: RetentionKey): number | null =>
  policy[key] ?? null;

export function daysText(days: number | null): string {
  if (days === null) return "Keep everything";
  if (days % 365 === 0) return days === 365 ? "1 year" : `${days / 365} years`;
  return days === 1 ? "1 day" : `${days} days`;
}

export const retentionChoices = (key: RetentionKey, current: number | null): (number | null)[] => {
  const choices = key === "audit_after_days" ? auditChoices : deletedChoices;
  const withSaved =
    current === null || choices.includes(current)
      ? choices
      : [...choices, current].sort((a, b) => a - b);
  return [null, ...withSaved];
};

export const retentionChange = (
  policy: RetentionPolicy,
  key: RetentionKey,
  days: number | null,
): RetentionPolicy => ({
  deleted_after_days: retentionDays(policy, "deleted_after_days"),
  audit_after_days: retentionDays(policy, "audit_after_days"),
  [key]: days,
});

export function retentionNotice(key: RetentionKey, days: number | null): string {
  if (key === "audit_after_days") {
    return days === null
      ? "Audit events are kept for good."
      : `Audit events older than ${daysText(days)} are removed.`;
  }
  return days === null
    ? "Deleted slides, annotations and results are kept for good."
    : `Deleted slides, annotations and results are removed after ${daysText(days)}.`;
}
