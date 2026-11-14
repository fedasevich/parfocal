import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { useState } from "react";

type ActivityGroup = "all" | "mentions" | "jobs";

type ActivityEntry = {
  id: string;
  group: Exclude<ActivityGroup, "all"> | "other";
  icon: IconName;
  title: string;
  detail?: string | undefined;
  time: string;
  read: boolean;
};

type ActivityFeedLabels = {
  filters: string;
  all: string;
  mentions: string;
  jobs: string;
  empty: string;
  unread: string;
};

type ActivityFeedProps = {
  entries: readonly ActivityEntry[];
  labels: ActivityFeedLabels;
  onOpen: (entry: ActivityEntry) => void;
  limit?: number;
};

function ActivityFeed({ entries, labels, onOpen, limit = 8 }: ActivityFeedProps) {
  const [group, setGroup] = useState<ActivityGroup>("all");
  const shown = entries.filter((entry) => group === "all" || entry.group === group).slice(0, limit);
  return (
    <div className="grid gap-3">
      <SegmentedControl
        fill
        aria-label={labels.filters}
        value={group}
        onValueChange={(value) => setGroup(value as ActivityGroup)}
        options={[
          { value: "all", label: labels.all },
          { value: "mentions", label: labels.mentions },
          { value: "jobs", label: labels.jobs },
        ]}
      />
      {shown.length === 0 ? (
        <p data-testid="activity-empty" className="m-0 text-body-sm text-fg-dim">
          {labels.empty}
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-1 p-0">
          {shown.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                data-testid="activity-row"
                onClick={() => onOpen(entry)}
                className="grid w-full cursor-pointer grid-cols-[8px_20px_minmax(0,1fr)_auto] items-start gap-2 rounded-md border-0 bg-transparent p-1 text-left text-body-sm"
              >
                {entry.read ? (
                  <span />
                ) : (
                  <span
                    role="img"
                    aria-label={labels.unread}
                    className="mt-1.5 size-1.75 rounded-full bg-accent-fill"
                  />
                )}
                <span className="text-fg-dim">
                  <Icon name={entry.icon} />
                </span>
                <span className="min-w-0">
                  <span className={entry.read ? "text-fg-dim" : "font-semibold text-fg"}>
                    {entry.title}
                  </span>
                  {entry.detail ? (
                    <small className="mt-0.5 block text-caption text-fg-faint">
                      {entry.detail}
                    </small>
                  ) : null}
                </span>
                <span className="whitespace-nowrap text-caption text-fg-faint">{entry.time}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export {
  type ActivityEntry,
  ActivityFeed,
  type ActivityFeedLabels,
  type ActivityFeedProps,
  type ActivityGroup,
};
