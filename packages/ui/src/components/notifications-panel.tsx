import { Button } from "@parfocal/ui/components/button";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { Switch } from "@parfocal/ui/components/switch";
import { CountBadge, ObjectIdTag } from "@parfocal/ui/components/tag";
import { useState } from "react";

type NotificationGroup = "all" | "mentions" | "jobs";

type NotificationItem = {
  id: string;
  group: Exclude<NotificationGroup, "all"> | "other";
  icon: IconName;
  title: string;
  detail?: string | undefined;
  quote?: { text: string; objectId: string; slide?: string | undefined } | undefined;
  time: string;
  read: boolean;
  action?: string | undefined;
};

type NotificationsPanelProps = {
  items: readonly NotificationItem[];
  onOpen: (item: NotificationItem) => void;
  onMarkAllRead: () => void;
  onClose: () => void;
};

const detailClass = "mt-0.5 block text-body-sm text-fg-dim leading-[1.45]";

function NotificationDetail({ item }: { item: NotificationItem }) {
  if (item.quote) {
    return (
      <small className={detailClass}>
        "{item.quote.text}" on <ObjectIdTag>{item.quote.objectId}</ObjectIdTag>
        {item.quote.slide ? ` · ${item.quote.slide}` : ""}
      </small>
    );
  }
  return item.detail ? <small className={detailClass}>{item.detail}</small> : null;
}

function NotificationRow({
  item,
  onOpen,
}: {
  item: NotificationItem;
  onOpen: (item: NotificationItem) => void;
}) {
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
        <Icon name={item.icon} />
      </span>
      <div className="min-w-0">
        <b className="block text-body-sm text-fg">{item.title}</b>
        <NotificationDetail item={item} />
        <Button size="sm" className="mt-2" onClick={() => onOpen(item)}>
          {item.action ?? "Open"}
        </Button>
      </div>
      <span className="whitespace-nowrap text-caption text-fg-faint">{item.time}</span>
    </li>
  );
}

function NotificationsPanel({ items, onOpen, onMarkAllRead, onClose }: NotificationsPanelProps) {
  const [tab, setTab] = useState<NotificationGroup>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const inTab = (item: NotificationItem, which: NotificationGroup) =>
    which === "all" || item.group === which;
  const unreadIn = (which: NotificationGroup) =>
    items.filter((item) => inTab(item, which) && !item.read).length;
  const shown = items.filter((item) => inTab(item, tab) && (!unreadOnly || !item.read));
  const anyUnread = items.some((item) => !item.read);
  const tabLabel = (which: NotificationGroup, label: string) => {
    const count = unreadIn(which);
    return (
      <span className="inline-flex items-center gap-2">
        {label}
        {count > 0 ? <CountBadge attention>{count}</CountBadge> : null}
      </span>
    );
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
          onValueChange={(value) => setTab(value as NotificationGroup)}
          options={[
            { value: "all", label: tabLabel("all", "For me") },
            { value: "mentions", label: tabLabel("mentions", "Mentions") },
            { value: "jobs", label: tabLabel("jobs", "Jobs") },
          ]}
        />
      </div>
      <ul className="m-0 min-h-0 list-none overflow-auto border-line border-t p-0">
        {shown.length > 0 ? (
          shown.map((item) => <NotificationRow key={item.id} item={item} onOpen={onOpen} />)
        ) : (
          <li className="flex items-center gap-2 px-4 py-6 text-body-sm text-fg-dim">
            <Icon name="check" />
            {unreadOnly ? "Nothing unread here" : "Nothing here yet"}
          </li>
        )}
      </ul>
      <div className="flex items-center justify-between px-4 py-3">
        {anyUnread ? (
          <Button variant="link" onClick={onMarkAllRead}>
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

export {
  type NotificationGroup,
  type NotificationItem,
  NotificationsPanel,
  type NotificationsPanelProps,
};
