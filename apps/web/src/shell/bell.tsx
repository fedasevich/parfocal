import {
  type InboxItem,
  useGetNotificationCounts,
  useListNotifications,
  useMarkNotificationsRead,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@parfocal/ui/components/popover";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { Switch } from "@parfocal/ui/components/switch";
import { CountBadge, ObjectIdTag } from "@parfocal/ui/components/tag";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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

const inTab = (item: InboxItem, tab: BellTab) => tabKinds[tab]?.includes(item.kind) ?? true;

export function useInboxRefresh() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: (query) => String(query.queryKey[0]).startsWith("/api/me/notifications"),
    });
}

function NotificationDetail({ item }: { item: InboxItem }) {
  const quote = payloadText(item, "quote");
  const objectId = payloadText(item, "object_id");
  if (quote && objectId) {
    return (
      <small className="mt-0.5 block text-body-sm text-fg-dim leading-[1.45]">
        "{quote}" on <ObjectIdTag>{objectId}</ObjectIdTag> · {payloadText(item, "slide_label")}
      </small>
    );
  }
  return (
    <small className="mt-0.5 block text-body-sm text-fg-dim leading-[1.45]">
      {payloadText(item, "detail")}
    </small>
  );
}

function NotificationRow({ item, onOpen }: { item: InboxItem; onOpen: (item: InboxItem) => void }) {
  return (
    <li
      data-testid="notification"
      className="grid grid-cols-[10px_30px_1fr_auto] items-start gap-2.5 border-line border-b px-4 py-3"
    >
      {item.read ? (
        <span />
      ) : (
        <span
          role="img"
          aria-label="Unread"
          className="mt-2.75 size-1.75 rounded-full bg-accent-fill"
        />
      )}
      <span className="grid size-7.5 place-items-center rounded-full bg-chrome-3 text-fg-dim">
        <Icon name={kindIcons[item.kind] ?? "bell"} />
      </span>
      <div className="min-w-0">
        <b className="block text-body-sm text-fg">{payloadText(item, "title")}</b>
        <NotificationDetail item={item} />
        <Button size="sm" className="mt-2" onClick={() => onOpen(item)}>
          {payloadText(item, "action") ?? "Open"}
        </Button>
      </div>
      <span className="whitespace-nowrap text-caption text-fg-faint">
        {relativeTime(new Date(item.created_at), now())}
      </span>
    </li>
  );
}

export function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<BellTab>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const items = okData(useListNotifications().data)?.notifications ?? [];
  const markRead = useMarkNotificationsRead();
  const refresh = useInboxRefresh();
  const goTo = useGoTo();
  const unreadIn = (which: BellTab) => items.filter((item) => inTab(item, which) && !item.read);
  const shown = items.filter((item) => inTab(item, tab) && (!unreadOnly || !item.read));
  const anyUnread = items.some((item) => !item.read);
  const tabLabel = (which: BellTab, label: string) => {
    const count = unreadIn(which).length;
    return (
      <span className="inline-flex items-center gap-2">
        {label}
        {count > 0 ? <CountBadge attention>{count}</CountBadge> : null}
      </span>
    );
  };
  const open = async (item: InboxItem) => {
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
    <div className="flex max-h-[780px] min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <b className="text-[16px] text-fg">Notifications</b>
        <span className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-caption text-fg-dim">
            Unread only
            <Switch size="sm" checked={unreadOnly} onCheckedChange={setUnreadOnly} />
          </label>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </Button>
        </span>
      </div>
      <div className="px-4 pb-2.5">
        <SegmentedControl
          fill
          aria-label="Show"
          value={tab}
          onValueChange={(value) => setTab(value as BellTab)}
          options={[
            { value: "all", label: tabLabel("all", "For me") },
            { value: "mentions", label: tabLabel("mentions", "Mentions") },
            { value: "jobs", label: tabLabel("jobs", "Jobs") },
          ]}
        />
      </div>
      <ul className="m-0 min-h-0 list-none overflow-auto border-line border-t p-0">
        {shown.length > 0 ? (
          shown.map((item) => (
            <NotificationRow key={item.id} item={item} onOpen={(chosen) => void open(chosen)} />
          ))
        ) : (
          <li className="flex items-center gap-2 px-4 py-6 text-body-sm text-fg-dim">
            <Icon name="check" />
            {unreadOnly ? "Nothing unread here" : "Nothing here yet"}
          </li>
        )}
      </ul>
      <div className="flex items-center justify-between px-4 py-3">
        {anyUnread ? (
          <Button variant="link" onClick={() => void markAll()}>
            Mark all read
          </Button>
        ) : (
          <span className="text-caption text-fg-dim">All read</span>
        )}
        <span className="inline-flex items-center gap-1 text-body-sm font-semibold text-fg-dim">
          See all
          <Icon name="next" />
        </span>
      </div>
    </div>
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
        <NotificationsPanel onClose={() => void overlay.set(undefined)} />
      </PopoverContent>
    </Popover>
  );
}
