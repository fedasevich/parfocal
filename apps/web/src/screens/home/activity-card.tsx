import { useLingui } from "@lingui/react/macro";
import { type InboxItem, useListNotifications } from "@parfocal/api-client";
import { type ActivityEntry, ActivityFeed } from "@parfocal/ui/components/activity-feed";
import { now } from "../../clock.ts";
import { inFilter, kindIcons, newestFirst, payloadText } from "../../shell/activity.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { relativeTime } from "../format.ts";
import { okData } from "../placeholder.tsx";
import { SideCard } from "./cards.tsx";

const groupOf = (item: InboxItem): ActivityEntry["group"] => {
  if (inFilter(item, "mentions")) return "mentions";
  if (inFilter(item, "jobs")) return "jobs";
  return "other";
};

export const toActivityEntry = (item: InboxItem): ActivityEntry => ({
  id: item.id,
  group: groupOf(item),
  icon: kindIcons[item.kind] ?? "bell",
  title: payloadText(item, "title") ?? "",
  detail: payloadText(item, "detail"),
  time: relativeTime(new Date(item.created_at), now()),
  read: item.read,
});

export function ActivityCard() {
  const goTo = useGoTo();
  const { t } = useLingui();
  const items = newestFirst(okData(useListNotifications().data)?.notifications ?? []);
  return (
    <SideCard title={t`Activity`}>
      <ActivityFeed
        entries={items.map(toActivityEntry)}
        labels={{
          filters: t`Show activity`,
          all: t`Everything`,
          mentions: t`Mentions`,
          jobs: t`Jobs`,
          empty: t`Nothing here yet`,
          unread: t`Unread`,
        }}
        onOpen={(entry) => {
          const item = items.find((candidate) => candidate.id === entry.id);
          if (item) void goTo(item.link);
        }}
      />
    </SideCard>
  );
}
