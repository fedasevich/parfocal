import {
  type InboxItem,
  useGetNotificationCounts,
  useListNotifications,
  useMarkNotificationsRead,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import {
  type NotificationItem,
  NotificationsPanel,
} from "@parfocal/ui/components/notifications-panel";
import { Popover, PopoverContent, PopoverTrigger } from "@parfocal/ui/components/popover";
import { useQueryClient } from "@tanstack/react-query";
import { now } from "../clock.ts";
import { relativeTime } from "../screens/format.ts";
import { okData } from "../screens/placeholder.tsx";
import { useOverlay } from "./overlays.ts";
import { useGoTo } from "./router-link.tsx";

type BellTab = "all" | "mentions" | "jobs";

const tabKinds: Record<BellTab, readonly string[] | null> = {
  all: null,
  mentions: ["mention", "reply"],
  jobs: ["model-run-finished", "model-run-paused", "upload-done"],
};

const kindIcons: Record<string, IconName> = {
  mention: "comment",
  reply: "comment",
  "model-run-finished": "smart",
  "model-run-paused": "warn",
  "upload-done": "upload",
  "task-signed-off": "check",
  "task-assigned": "users",
};

export const payloadText = (item: InboxItem, key: string): string | undefined => {
  const value = item.payload[key];
  return typeof value === "string" ? value : undefined;
};

export function useInboxRefresh() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: (query) => String(query.queryKey[0]).startsWith("/api/me/notifications"),
    });
}

const groupOf = (item: InboxItem): NotificationItem["group"] => {
  if (tabKinds.mentions?.includes(item.kind)) return "mentions";
  if (tabKinds.jobs?.includes(item.kind)) return "jobs";
  return "other";
};

const toNotification = (item: InboxItem): NotificationItem => {
  const quote = payloadText(item, "quote");
  const objectId = payloadText(item, "object_id");
  return {
    id: item.id,
    group: groupOf(item),
    icon: kindIcons[item.kind] ?? "bell",
    title: payloadText(item, "title") ?? "",
    detail: payloadText(item, "detail"),
    quote:
      quote && objectId
        ? { text: quote, objectId, slide: payloadText(item, "slide_label") }
        : undefined,
    time: relativeTime(new Date(item.created_at), now()),
    read: item.read,
    action: payloadText(item, "action"),
  };
};

function InboxPanel({ onClose }: { onClose: () => void }) {
  const inbox = okData(useListNotifications().data)?.notifications ?? [];
  const markRead = useMarkNotificationsRead();
  const refresh = useInboxRefresh();
  const goTo = useGoTo();
  const open = async (chosen: NotificationItem) => {
    const item = inbox.find((candidate) => candidate.id === chosen.id);
    if (!item) return;
    if (!item.read) await markRead.mutateAsync({ data: { ids: [item.id] } });
    await refresh();
    onClose();
    await goTo(item.link);
  };
  const markAll = async () => {
    await markRead.mutateAsync({ data: { all: true } });
    await refresh();
  };
  return (
    <NotificationsPanel
      items={inbox.map(toNotification)}
      onOpen={(item) => void open(item)}
      onMarkAllRead={() => void markAll()}
      onClose={onClose}
    />
  );
}

export function Bell() {
  const overlay = useOverlay();
  const unread = okData(useGetNotificationCounts().data)?.unread ?? 0;
  const isOpen = overlay.open === "notifications";
  return (
    <Popover
      open={isOpen}
      onOpenChange={(next) => void overlay.set(next ? "notifications" : undefined)}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={`Notifications, ${unread} unread`}
            title={`Notifications: ${unread} unread. Mentions, replies, tasks and jobs`}
          />
        }
      >
        <Icon name="bell" />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-0.5 right-px h-4 min-w-4 rounded-lg bg-accent-fill px-1 text-center text-label leading-4 font-bold text-on-accent"
          >
            {unread}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="Notifications"
        className="w-110 gap-0 overflow-hidden p-0"
      >
        <InboxPanel onClose={() => void overlay.set(undefined)} />
      </PopoverContent>
    </Popover>
  );
}
