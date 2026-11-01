import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  ConfirmInButton,
  DoneTaskRow,
  NudgeModal,
  ReassignModal,
  type ReassignWhat,
  ReviewerRow,
  TaskBlock,
  TeamNoMatch,
} from "../src/components/team.tsx";
import { UndoToast } from "../src/components/undo-toast.tsx";
import { people } from "./fixtures.ts";

const meta = {
  title: "Components/Team",
  decorators: [
    (Story) => (
      <div className="w-[960px] rounded-zone bg-chrome p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const EveryStatus: Story = {
  render: () => (
    <TaskBlock
      code="RT-14"
      title="Round 2 · CAMELYON v1.0"
      project="Sentinel node AI evaluation · 12 slides"
      due="Fri 23 Oct"
      dueIn="in 8 days"
    >
      <ReviewerRow
        person={people.LM}
        done={7}
        of={12}
        last="last decision 10 min ago"
        status="on-track"
      />
      <ReviewerRow
        person={people.SM}
        done={4}
        of={12}
        last="8 slides left · about 2 h 40 min"
        status="behind"
      />
      <ReviewerRow person={people.JR} done={0} of={8} last="told just now" status="not-started" />
      <ReviewerRow person={people.TB} done={9} of={9} last="all 9 submitted" status="done" />
      <ReviewerRow
        person={people.DH}
        done={3}
        of={12}
        last="last decision today"
        status="on-track"
        you
      />
    </TaskBlock>
  ),
};

export const NudgedAndHighlighted: Story = {
  render: () => (
    <TaskBlock
      code="RT-14"
      title="Round 2 · CAMELYON v1.0"
      project="Sentinel node AI evaluation · 12 slides"
      due="Fri 23 Oct"
      dueIn="in 8 days"
    >
      <ReviewerRow
        person={people.SM}
        done={4}
        of={12}
        last="8 slides left · about 2 h 40 min"
        status="behind"
        nudged
        highlight
      />
    </TaskBlock>
  ),
};

export const AwayWithHint: Story = {
  render: () => (
    <TaskBlock
      code="RT-15"
      title="PathoSAM vs CAMELYON"
      project="Sentinel node AI evaluation · 12 slides"
      due="Tue 27 Oct"
      dueIn="in 12 days"
    >
      <ReviewerRow
        person={people.AK}
        done={0}
        of={12}
        last="not opened yet"
        status="away"
        awayUntil="Mon 19 Oct"
        hint="RT-15 waits for Anna. Reassign if it cannot."
      />
    </TaskBlock>
  ),
};

export const Overdue: Story = {
  render: () => (
    <TaskBlock
      code="RT-14"
      title="Round 2 · CAMELYON v1.0"
      project="Sentinel node AI evaluation · 12 slides"
      due="Fri 23 Oct"
      dueIn="overdue by 1 day"
      overdue
      highlight
    >
      <ReviewerRow
        person={people.LM}
        done={7}
        of={12}
        last="5 slides left · about 1 h 40 min"
        status="behind"
      />
    </TaskBlock>
  ),
};

export const DoneTasks: Story = {
  render: () => (
    <div className="grid gap-2">
      <DoneTaskRow
        code="RT-11"
        title="TIL typing, first 40"
        project="Breast TILs, cell typing"
        people={[people.AK, people.SM, people.LM]}
        signedOn="14 Oct"
      />
      <DoneTaskRow
        code="RT-09"
        title="Round 1 · CAMELYON v1.0"
        project="Sentinel node AI evaluation"
        people={[people.LM, people.SM]}
        signedOn="9 Oct"
      />
    </div>
  ),
};

export const NoMatch: Story = {
  render: () => <TeamNoMatch>No open task matches these filters.</TeamNoMatch>,
};

export const NudgeAllBehind: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-6">
      <ConfirmInButton label="Nudge all behind" question="Nudge Simona?" confirm="Yes, nudge" />
      <ConfirmInButton
        label="Nudge all behind"
        question="Nudge 2 people?"
        confirm="Yes, nudge"
        asking
      />
      <ConfirmInButton
        label="Nudge all behind"
        question=""
        confirm="Yes, nudge"
        disabled
        title="Nobody is behind right now"
      />
    </div>
  ),
};

const nudgeText =
  "Hi Simona, RT-14 is due Fri 23 Oct and 8 slides are left. Could you fit some in this week?";

export const Nudge: Story = {
  render: function Render() {
    const [message, setMessage] = useState(nudgeText);
    return (
      <NudgeModal
        open
        onOpenChange={() => undefined}
        subtitle="RT-14 · Round 2 · CAMELYON v1.0"
        person={people.SM}
        done={4}
        of={12}
        message={message}
        onMessageChange={setMessage}
        onSend={() => undefined}
      />
    );
  },
};

const candidates = [
  {
    id: "LM",
    name: people.LM.name,
    sub: people.LM.role,
    person: people.LM,
    dim: "Reviews this task",
  },
  {
    id: "SM",
    name: people.SM.name,
    sub: people.SM.role,
    person: people.SM,
    dim: "Has these slides now",
  },
  { id: "AK", name: people.AK.name, sub: people.AK.role, person: people.AK },
  { id: "JR", name: people.JR.name, sub: people.JR.role, person: people.JR },
  { id: "TB", name: people.TB.name, sub: people.TB.role, person: people.TB },
  {
    id: "PK",
    name: people.PK.name,
    sub: "Consultant · breast, GI",
    person: people.PK,
    end: "Away until 22 Oct",
    endTone: "warn" as const,
  },
];

function ReassignStory({
  initialWhat,
  initialTo,
}: {
  initialWhat: ReassignWhat;
  initialTo: string | null;
}) {
  const [to, setTo] = useState(initialTo);
  const [what, setWhat] = useState(initialWhat);
  const [note, setNote] = useState("");
  return (
    <ReassignModal
      open
      onOpenChange={() => undefined}
      subtitle="RT-14 · Round 2 · CAMELYON v1.0"
      from={people.SM}
      done={4}
      of={12}
      candidates={candidates}
      to={to}
      onToChange={setTo}
      toWarning={
        to === "PK" ? "Petra Králová is away until 22 Oct. The slides wait until then." : undefined
      }
      what={what}
      onWhatChange={setWhat}
      note={note}
      onNoteChange={setNote}
      onReassign={() => undefined}
    />
  );
}

export const Reassign: Story = {
  render: () => <ReassignStory initialWhat="rest" initialTo={null} />,
};

export const ReassignEverySlide: Story = {
  render: () => <ReassignStory initialWhat="all" initialTo="JR" />,
};

export const AfterAnAction: Story = {
  render: () => (
    <UndoToast
      duration={0}
      message="8 slides of RT-14 moved to Jan Růžička. Both are told by email."
    />
  ),
};
