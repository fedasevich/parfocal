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
};

export const payloadText = (item: InboxItem, key: string): string | undefined => {
  const value = item.payload[key];
  return typeof value === "string" ? value : undefined;
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
