import type { InboxItem } from "@parfocal/api-client";
import type { IconName } from "@parfocal/ui/components/icon";

export type ActivityFilter = "all" | "mentions" | "jobs";

export const activityFilters: readonly { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "mentions", label: "Mentions" },
  { value: "jobs", label: "Jobs" },
];

export const filterKinds: Record<ActivityFilter, readonly string[] | null> = {
  all: null,
  mentions: ["mention", "reply"],
  jobs: ["model-run-finished", "model-run-paused", "upload-done", "upload-refused"],
};

export const kindIcons: Record<string, IconName> = {
  mention: "comment",
  reply: "comment",
  "model-run-finished": "smart",
  "model-run-paused": "warn",
  "upload-done": "upload",
  "upload-refused": "warn",
  "task-signed-off": "check",
  "task-assigned": "users",
  "workspace-access-asked": "users",
  "template-offered": "file",
  "project-access-asked": "users",
  "integration-down": "warn",
};

export const payloadText = (item: InboxItem, key: string): string | undefined => {
  const value = item.payload[key];
  return typeof value === "string" ? value : undefined;
};

export const detailOf = (item: Pick<InboxItem, "payload">): string | undefined => {
  const written = item.payload.detail;
  if (typeof written === "string" && written !== "") return written;
  const task = item.payload.task_name;
  if (typeof task !== "string" || task === "") return undefined;
  const slides = item.payload.slides;
  if (typeof slides !== "number") return task;
  return `${task} · ${slides} ${slides === 1 ? "slide" : "slides"}`;
};

export const kindTitles: Record<string, string> = {
  mention: "You were mentioned",
  reply: "New reply",
  "task-assigned": "New review task",
  "task-due-soon": "Review task due soon",
  "task-nudged": "A note about your review task",
  "task-reassigned": "Review slides moved",
  "task-due-changed": "Review task due date changed",
  "task-signed-off": "Task signed off",
  "model-run-finished": "Model run finished",
  "model-run-paused": "Model run paused",
  "upload-done": "Upload done",
  "upload-refused": "Upload refused",
  "disagreements-ready": "Disagreements to decide",
  "emergency-access": "Emergency access to your project",
  "result-set-added": "Results added",
  "integration-down": "Integration down",
  "adjudication-requested": "Objects to adjudicate",
  "slide-moved": "Slide moved",
  "workspace-access-asked": "Someone asked to join your workspace",
  "template-offered": "A report layout was offered as a template",
  "project-access-asked": "Someone asked to join your project",
};

export const titleOf = (item: Pick<InboxItem, "kind" | "payload">): string => {
  const written = item.payload.title;
  if (typeof written === "string" && written !== "") return written;
  return kindTitles[item.kind] ?? "Something happened";
};

export const inFilter = (item: Pick<InboxItem, "kind">, filter: ActivityFilter): boolean => {
  const kinds = filterKinds[filter];
  return kinds === null || kinds.includes(item.kind);
};

export const filteredActivity = <T extends Pick<InboxItem, "kind">>(
  items: readonly T[],
  filter: ActivityFilter,
): T[] => items.filter((item) => inFilter(item, filter));

export const unreadIn = (
  items: readonly Pick<InboxItem, "kind" | "read">[],
  filter: ActivityFilter,
): number => items.filter((item) => inFilter(item, filter) && !item.read).length;

export const newestFirst = <T extends Pick<InboxItem, "created_at">>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

export const isNotificationsQuery = (queryKey: readonly unknown[]): boolean => {
  const root = queryKey[0];
  return typeof root === "string" && root.startsWith("/api/me/notifications");
};
