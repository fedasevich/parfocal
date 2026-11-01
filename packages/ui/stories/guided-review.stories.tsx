import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CellCluster, CellsLauncher, CellsPanel } from "../src/components/cells-panel.tsx";
import {
  CommentComposer,
  type CommentMessage,
  CommentThread,
  MentionPicker,
} from "../src/components/comment-thread.tsx";
import { GalleryTile } from "../src/components/gallery-tile.tsx";
import { SidePanel } from "../src/components/side-panel.tsx";
import { mockAssets, people } from "./fixtures.ts";

const meta = {
  title: "Components/Guided review",
  decorators: [
    (Story) => (
      <div className="bg-chrome p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const decisions = ["agree", "agree", "disagree", "agree", "unsure", "open", "open"] as const;

const cellIds = Array.from({ length: 50 }, (_, index) => `T1·C${index + 101}`);

function crops(count: number, ringed = false) {
  return cellIds.slice(0, count).map((objectId, index) => {
    const decision = decisions[index % decisions.length] ?? "open";
    return (
      <GalleryTile
        key={objectId}
        size={40}
        image={mockAssets.hpf}
        objectId={objectId}
        label="tumor cell"
        state={index === 12 ? "current" : decision === "open" ? "to-check" : "done"}
        decision={decision}
        ringed={ringed && decision === "open"}
        imagePosition={`${-(index % 13) * 120}px ${-Math.floor(index / 13) * 160}px`}
        imageSize="2240px 1400px"
      />
    );
  });
}

export const CellsPanelOpen: Story = {
  render: () => (
    <CellsPanel decided={44} total={50} answerKeys={["K", "X", "U"]} className="w-fit">
      {crops(50)}
    </CellsPanel>
  ),
};

export const CellsPanelAgreeWithTheRest: Story = {
  render: () => (
    <CellsPanel
      decided={44}
      total={50}
      answerKeys={["K", "X", "U"]}
      confirmRest={6}
      className="w-fit"
    >
      {crops(50, true)}
    </CellsPanel>
  ),
};

export const CellsPanelFolded: Story = {
  render: () => (
    <CellsPanel decided={44} total={50} answerKeys={["K", "X", "U"]} folded className="w-fit" />
  ),
};

export const CellsPanelBlind: Story = {
  render: () => (
    <CellsPanel
      decided={44}
      total={50}
      answerKeys={["1", "2", "3", "4", "U"]}
      canAgreeRest={false}
      className="w-fit"
    >
      {crops(50)}
    </CellsPanel>
  ),
};

export const CellsLauncherAndCluster: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <CellsLauncher decided={44} total={50} />
      <CellCluster split={{ agree: 41, disagree: 2, unsure: 1, open: 6 }} />
    </div>
  ),
};

const thread: CommentMessage[] = [
  {
    id: "1",
    author: people.DH,
    researcher: true,
    at: "15 Oct 10:02",
    text: "Does the boundary run past the capsule fold here?",
  },
  {
    id: "2",
    author: people.LM,
    you: true,
    at: "15 Oct 10:12",
    text: "I measure 1.6 mm past it. Extranodal extension, or still inside the capsule?",
    replyTo: "1",
  },
  {
    id: "3",
    author: people.DH,
    researcher: true,
    at: "15 Oct 10:30",
    text: "The model draws T2 past the fold. If you disagree with the boundary, mark it so it counts in the evaluation.",
    replyTo: "1",
  },
];

function Composer({ initial, picker }: { initial: string; picker?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="w-[430px]">
      <CommentComposer
        value={value}
        onValueChange={setValue}
        label="Comment on T2"
        hint="Blind review. Other reviewers see it after they submit."
        picker={
          picker ? (
            <MentionPicker
              query="Da"
              activeId="DH"
              options={[{ id: "DH", person: people.DH, sub: "Researcher · AI evaluation" }]}
            />
          ) : undefined
        }
      />
    </div>
  );
}

export const CommentsOnAnObject: Story = {
  render: () => (
    <div className="grid w-[430px] gap-4">
      <CommentThread messages={thread} onReply={() => undefined} />
      <Composer initial="" />
    </div>
  ),
};

export const CommentWithAMention: Story = {
  render: () => <Composer initial="Worth a CK level here? @Da" picker />,
};

export const MentionPickerStates: Story = {
  render: () => (
    <div className="grid w-[360px] gap-4">
      <MentionPicker
        query="S"
        activeId="TB"
        options={[
          { id: "TB", person: people.TB, sub: "Pathologist · nodes" },
          {
            id: "SM",
            person: people.SM,
            sub: "Consultant · consults",
            disabledReason: "Reviews this task blind",
          },
        ]}
      />
      <MentionPicker query="Zz" options={[]} />
    </div>
  ),
};

function QuietTabs() {
  const [tab, setTab] = useState("comments");
  return (
    <div className="h-[260px]">
      <SidePanel
        width={470}
        variant="quiet"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "review", label: "Review", body: <p>The question card.</p> },
          { value: "comments", label: "Comments", count: 3, body: <p>The thread on T2.</p> },
          { value: "display", label: "Display", body: <p>The Display panel.</p> },
        ]}
      />
    </div>
  );
}

export const GuidedSidePanelTabs: Story = { render: () => <QuietTabs /> };
