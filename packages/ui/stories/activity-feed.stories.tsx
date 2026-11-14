import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  type ActivityEntry,
  ActivityFeed,
  type ActivityFeedLabels,
} from "../src/components/activity-feed.tsx";

const meta = {
  title: "Components/Activity feed",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const labels: ActivityFeedLabels = {
  filters: "Show activity",
  all: "Everything",
  mentions: "Mentions",
  jobs: "Jobs",
  empty: "Nothing here yet",
  unread: "Unread",
};

const seeded: ActivityEntry[] = [
  {
    id: "a1",
    group: "mentions",
    icon: "comment",
    title: "Lenka Malá mentioned you",
    detail: "Is this the capsule? on T7 · A1",
    time: "5 min ago",
    read: false,
  },
  {
    id: "a2",
    group: "jobs",
    icon: "smart",
    title: "PathoSAM finished on 12 slides",
    detail: "Result set added to the project",
    time: "1 h ago",
    read: false,
  },
  {
    id: "a3",
    group: "mentions",
    icon: "comment",
    title: "Tomáš Král replied to your comment",
    time: "3 h ago",
    read: true,
  },
  {
    id: "a4",
    group: "jobs",
    icon: "upload",
    title: "Import finished: 40 slides",
    time: "Yesterday",
    read: true,
  },
  {
    id: "a5",
    group: "other",
    icon: "check",
    title: "Round 2 was signed off",
    time: "2 days ago",
    read: true,
  },
];

function Stage({ entries, opened }: { entries: ActivityEntry[]; opened?: boolean }) {
  const [last, setLast] = useState("none");
  return (
    <div className="w-80 rounded-xl border border-line bg-chrome p-4 text-fg">
      <ActivityFeed entries={entries} labels={labels} onOpen={(entry) => setLast(entry.id)} />
      {opened ? (
        <output data-testid="opened" className="sr-only">
          {last}
        </output>
      ) : null}
    </div>
  );
}

export const Seeded: Story = {
  render: () => <Stage entries={seeded} opened />,
};

export const Empty: Story = {
  render: () => <Stage entries={[]} />,
};

export const DarkAndLight: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-2.5">
      {(["dark", "light"] as const).map((theme) => (
        <div key={theme} data-theme={theme} className="bg-chrome p-4 text-fg">
          <Stage entries={seeded} />
        </div>
      ))}
    </div>
  ),
};
