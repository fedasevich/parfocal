import type { Meta, StoryObj } from "@storybook/react-vite";
import { TabCount, Tabs, TabsContent, TabsList, TabsTrigger } from "../src/components/tabs.tsx";

const meta = {
  title: "Controls/Tabs",
  component: Tabs,
} satisfies Meta<typeof Tabs>;

export default meta;

type Story = StoryObj<typeof meta>;

type Kind = "default" | "line" | "page" | "panel" | "quiet";

type Tab = { value: string; label: string; count?: number; disabled?: boolean; body: string };

const sets: Record<Kind, { label: string; width: string; tabs: Tab[] }> = {
  default: {
    label: "Objects in view",
    width: "w-80",
    tabs: [
      { value: "cells", label: "Cells", count: 1204, body: "1,204 cells in view." },
      { value: "regions", label: "Regions", count: 3, body: "3 regions in view." },
      { value: "notes", label: "Notes", disabled: true, body: "No notes yet." },
    ],
  },
  line: {
    label: "Objects in view",
    width: "w-80",
    tabs: [
      { value: "cells", label: "Cells", count: 1204, body: "1,204 cells in view." },
      { value: "regions", label: "Regions", count: 3, body: "3 regions in view." },
      { value: "notes", label: "Notes", disabled: true, body: "No notes yet." },
    ],
  },
  page: {
    label: "My work",
    width: "w-[560px]",
    tabs: [
      { value: "review", label: "To review", count: 4, body: "4 slides to review." },
      { value: "assigned", label: "Assigned by me", count: 2, body: "2 tasks you assigned." },
      { value: "all", label: "All slides", count: 38, body: "38 slides in your projects." },
    ],
  },
  panel: {
    label: "Inspector",
    width: "w-[340px]",
    tabs: [
      { value: "objects", label: "Objects", count: 12, body: "12 objects on this slide." },
      { value: "display", label: "Display", body: "How results draw on the slide." },
      { value: "comments", label: "Comments", count: 3, body: "3 open threads." },
      { value: "opinion", label: "Opinion", body: "Your opinion on this slide." },
    ],
  },
  quiet: {
    label: "Side panel",
    width: "w-[400px]",
    tabs: [
      { value: "review", label: "Review", body: "Object 3 of 12." },
      { value: "comments", label: "Comments", count: 2, body: "2 messages on this object." },
      { value: "display", label: "Display", body: "How results draw on the slide." },
    ],
  },
};

function Example({ kind, counts }: { kind: Kind; counts: boolean }) {
  const set = sets[kind];
  return (
    <Tabs defaultValue={set.tabs[0]?.value} className={set.width}>
      <TabsList variant={kind} aria-label={set.label}>
        {set.tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} disabled={tab.disabled ?? false}>
            {tab.label}
            {counts && tab.count !== undefined ? <TabCount>{tab.count}</TabCount> : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {set.tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="p-2 text-fg-dim">
          {tab.body}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export const Default: Story = {
  render: () => <Example kind="default" counts={false} />,
};

export const Line: Story = {
  render: () => <Example kind="line" counts={false} />,
};

export const Page: Story = {
  render: () => <Example kind="page" counts={false} />,
};

export const PageWithCounts: Story = {
  render: () => <Example kind="page" counts />,
};

export const Panel: Story = {
  render: () => <Example kind="panel" counts={false} />,
};

export const PanelWithCounts: Story = {
  render: () => <Example kind="panel" counts />,
};

export const Quiet: Story = {
  render: () => <Example kind="quiet" counts={false} />,
};

export const QuietWithCounts: Story = {
  render: () => <Example kind="quiet" counts />,
};
