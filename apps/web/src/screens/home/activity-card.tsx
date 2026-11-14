import { Trans, useLingui } from "@lingui/react/macro";
import { type InboxItem, useListNotifications } from "@parfocal/api-client";
import { Icon } from "@parfocal/ui/components/icon";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { useState } from "react";
import { now } from "../../clock.ts";
import {
  type ActivityFilter,
  activityFilters,
  filteredActivity,
  kindIcons,
  newestFirst,
  payloadText,
} from "../../shell/activity.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { relativeTime } from "../format.ts";
import { okData } from "../placeholder.tsx";
import { SideCard } from "./cards.tsx";

const visibleLimit = 8;

export function ActivityRows({
  items,
  filter,
  onOpen,
}: {
  items: readonly InboxItem[];
  filter: ActivityFilter;
  onOpen: (item: InboxItem) => void;
}) {
  const rows = newestFirst(filteredActivity(items, filter)).slice(0, visibleLimit);
  if (rows.length === 0) {
    return (
      <p className="m-0 text-body-sm text-fg-dim">
        <Trans>Nothing here yet</Trans>
      </p>
    );
  }
  return (
    <ul className="m-0 grid list-none gap-1 p-0">
      {rows.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            data-testid="activity-row"
            onClick={() => onOpen(item)}
            className="grid w-full cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-md border-0 bg-transparent p-1 text-left text-body-sm"
          >
            <Icon name={kindIcons[item.kind] ?? "bell"} />
            <span className="min-w-0">
              <span className={item.read ? "text-fg-dim" : "font-semibold text-fg"}>
                {payloadText(item, "title") ?? ""}
              </span>
              {payloadText(item, "detail") ? (
                <small className="mt-0.5 block text-caption text-fg-faint">
                  {payloadText(item, "detail")}
                </small>
              ) : null}
            </span>
            <span className="whitespace-nowrap text-caption text-fg-faint">
              {relativeTime(new Date(item.created_at), now())}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ActivityCard() {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const goTo = useGoTo();
  const { t } = useLingui();
  const items = okData(useListNotifications().data)?.notifications ?? [];
  return (
    <SideCard title={t`Activity`}>
      <SegmentedControl
        fill
        aria-label={t`Show activity`}
        value={filter}
        onValueChange={(value) => setFilter(value as ActivityFilter)}
        options={activityFilters.map(({ value, label }) => ({ value, label }))}
      />
      <ActivityRows items={items} filter={filter} onOpen={(item) => void goTo(item.link)} />
    </SideCard>
  );
}
