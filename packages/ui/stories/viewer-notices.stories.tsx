import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../src/components/button.tsx";
import { SaveStatusWord, ViewerNotices } from "../src/components/viewer-notices.tsx";
import { type NoticeFacts, planNotices } from "../src/lib/viewer-notices.ts";

const meta = {
  title: "Components/Viewer notices",
  decorators: [
    (Story) => (
      <div className="w-[860px] overflow-hidden rounded-zone border border-line bg-chrome">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const calm: NoticeFacts = { phase: "saved", attempt: 0, conflicts: 0, lost: false, incoming: 0 };

const titles = [
  "A colleague changed the shape you changed",
  "A colleague deleted the shape you changed",
];

function Sketch() {
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label="Your outline, solid blue, over your colleague's outline, dashed orange"
      className="size-16 shrink-0 rounded-ctl border border-line bg-chrome-2"
    >
      <polygon
        points="18,22 70,18 78,66 26,74"
        strokeWidth={2}
        className="fill-none stroke-accent"
      />
      <polygon
        points="30,30 84,28 88,80 36,86"
        strokeWidth={3}
        strokeDasharray="6 4"
        className="fill-none stroke-warn"
      />
    </svg>
  );
}

function Frame({ facts, unsaved = 0 }: { facts: NoticeFacts; unsaved?: number }) {
  const plan = planNotices(facts);
  return (
    <>
      <div className="flex h-11 items-center gap-3 border-line border-b px-4 text-body-sm">
        <b>tumor_044</b>
        <span className="text-fg-dim">Slide 3 of 12</span>
        <span className="flex-1" />
        <SaveStatusWord word={plan.word} unsaved={unsaved} />
      </div>
      <ViewerNotices
        plan={plan}
        unsaved={unsaved}
        conflict={
          facts.conflicts === 0
            ? undefined
            : {
                id: "c1",
                title: titles[0] ?? "",
                preview: <Sketch />,
                more: facts.conflicts - 1,
                onKeepMine: () => {},
                onKeepTheirs: () => {},
              }
        }
        changes={
          facts.incoming === 0
            ? undefined
            : { text: "Anna Kovářová added 2, changed 1", onShow: () => {} }
        }
        onRetry={() => {}}
        onDismissNotSaved={() => {}}
      />
      <div className="grid h-28 place-items-center bg-chrome-2 text-caption text-fg-dim">Slide</div>
    </>
  );
}

export const Saved: Story = { render: () => <Frame facts={calm} /> };

export const Saving: Story = { render: () => <Frame facts={{ ...calm, phase: "saving" }} /> };

export const ShortBlip: Story = {
  render: () => <Frame facts={{ ...calm, phase: "retrying", attempt: 1 }} unsaved={1} />,
};

export const LongOffline: Story = {
  render: () => <Frame facts={{ ...calm, phase: "retrying", attempt: 4 }} unsaved={2} />,
};

export const NotSaved: Story = {
  render: () => <Frame facts={{ ...calm, lost: true }} />,
};

export const ColleagueChanges: Story = {
  render: () => <Frame facts={{ ...calm, incoming: 1 }} />,
};

export const Conflict: Story = {
  render: () => <Frame facts={{ ...calm, phase: "conflict", conflicts: 1 }} />,
};

export const ConflictWithOthersWaiting: Story = {
  render: () => (
    <Frame facts={{ ...calm, phase: "failed", conflicts: 2, lost: true, incoming: 1 }} />
  ),
};

function Session() {
  const [conflicts, setConflicts] = useState(0);
  const [incoming, setIncoming] = useState(0);
  const [lost, setLost] = useState(false);
  const [log, setLog] = useState<readonly string[]>([]);
  const plan = planNotices({
    phase: conflicts > 0 ? "conflict" : "saved",
    attempt: 0,
    conflicts,
    lost,
    incoming,
  });
  const resolve = (choice: string) => () => {
    setLog((before) => [...before, `${choice} ${3 - conflicts}`]);
    setConflicts((before) => before - 1);
  };
  return (
    <>
      <div className="flex h-11 items-center gap-2 border-line border-b px-4 text-body-sm">
        <Button size="sm" onClick={() => setConflicts(2)}>
          Two conflicts
        </Button>
        <Button size="sm" onClick={() => setIncoming(1)}>
          Colleague saves
        </Button>
        <Button size="sm" onClick={() => setLost(true)}>
          Server refuses
        </Button>
        <span className="flex-1" />
        <SaveStatusWord word={plan.word} unsaved={0} />
      </div>
      <ViewerNotices
        plan={plan}
        unsaved={0}
        conflict={
          conflicts === 0
            ? undefined
            : {
                id: `c${conflicts}`,
                title: titles[2 - conflicts] ?? "",
                preview: <Sketch />,
                more: conflicts - 1,
                onKeepMine: resolve("mine"),
                onKeepTheirs: resolve("theirs"),
              }
        }
        changes={
          incoming === 0
            ? undefined
            : { text: "Anna Kovářová added 1", onShow: () => setIncoming(0) }
        }
        onRetry={() => {}}
        onDismissNotSaved={() => setLost(false)}
      />
      <output className="block px-4 py-3 text-caption text-fg-dim">
        {log.length === 0 ? "No choice yet" : log.join(", ")}
      </output>
    </>
  );
}

export const Interactive: Story = { render: () => <Session /> };
