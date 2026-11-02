import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CommentsTab, type CommentThreadCard } from "../src/components/comments-tab.tsx";
import { people } from "./fixtures.ts";

const meta = {
  title: "Components/Comments tab",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const threads: CommentThreadCard[] = [
  {
    id: "t2",
    anchor: "T2",
    kind: "Tumor region",
    title: "Does the boundary run past the capsule fold?",
    author: people.DH,
    messages: 3,
    at: "15 Oct 10:02",
    resolved: false,
  },
  {
    id: "c145",
    anchor: "T1·C145",
    kind: "Cell",
    title: "Histiocyte, not tumor",
    author: people.LM,
    messages: 2,
    at: "15 Oct 09:40",
    resolved: false,
  },
  {
    id: "r2",
    anchor: "R2⁺",
    kind: "Your ROI",
    title: "Check this rim on the CK slide",
    author: people.LM,
    messages: 1,
    at: "15 Oct 10:44",
    resolved: false,
  },
  {
    id: "t4",
    anchor: "T4",
    kind: "Tumor region",
    title: "Reactive sinus histiocytes, no atypia",
    author: people.SM,
    messages: 1,
    at: "16 Oct 15:30",
    resolved: true,
  },
];

function Tab({ items, start }: { items: CommentThreadCard[]; start?: string }) {
  const [selected, setSelected] = useState(start);
  const [went, setWent] = useState("");
  const [created, setCreated] = useState(0);
  return (
    <div className="grid w-80 gap-3">
      <CommentsTab
        slideLabel="A1"
        threads={items}
        selectedId={selected}
        onSelect={setSelected}
        onGoTo={(id) => setWent(items.find((item) => item.id === id)?.anchor ?? "")}
        onNewComment={() => setCreated(created + 1)}
      />
      <output data-testid="went" className="text-caption text-fg-dim">
        {went ? `Went to ${went}` : "Nowhere yet"}
      </output>
      <output data-testid="created" className="text-caption text-fg-dim">
        {created} new comment requests
      </output>
    </div>
  );
}

export const OpenThreads: Story = { render: () => <Tab items={threads} start="t2" /> };

export const OnlyResolved: Story = {
  render: () => <Tab items={threads.map((thread) => ({ ...thread, resolved: true }))} />,
};

export const NoThreads: Story = { render: () => <Tab items={[]} /> };
