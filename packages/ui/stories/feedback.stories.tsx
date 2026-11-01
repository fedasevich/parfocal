import type { Meta, StoryObj } from "@storybook/react-vite";
import { Banner, InlineError, InlineState } from "../src/components/banner.tsx";
import { BeforeYouList } from "../src/components/before-you-list.tsx";
import { Button } from "../src/components/button.tsx";
import { AvatarStack, Person, PresenceDot } from "../src/components/person.tsx";
import { ProgressBar, ProgressRing, StackedBar } from "../src/components/progress-meter.tsx";
import { Toast, UndoToast } from "../src/components/undo-toast.tsx";
import { FoldingZone, Hint, SectionLabel, Surface, Zone, Zones } from "../src/components/zone.tsx";
import { people } from "./fixtures.ts";

const meta = {
  title: "Components/Feedback and surfaces",
  decorators: [
    (Story) => (
      <div className="rounded-zone bg-chrome p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Banners: Story = {
  render: () => (
    <div className="grid w-[720px] gap-3">
      <Banner actions={<Button size="sm">Retry now</Button>}>
        <b>Connection lost.</b> Decisions can't be saved right now. Nothing is lost. Retrying…
      </Banner>
      <Banner tone="info">The coarse level shows first and sharper tiles fade in.</Banner>
      <Banner tone="bad" inline>
        The slide cannot be read at 20x and 40x. Lower levels still show.
      </Banner>
    </div>
  ),
};

export const InlineErrors: Story = {
  render: () => (
    <div className="grid w-96 gap-4">
      <InlineError>
        The review could not be submitted. Nothing was lost, every decision is saved.
      </InlineError>
      <InlineError
        actions={
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 font-medium text-accent"
          >
            Use a password instead
          </button>
        }
      >
        Single sign-on did not answer. Nothing was signed.
      </InlineError>
      <InlineError tone="warn">
        Lenka Malá is away until 22 Oct. The task waits for her.
      </InlineError>
    </div>
  ),
};

export const EmptyState: Story = {
  render: () => (
    <InlineState
      className="w-[640px]"
      icon="info"
      title="Nothing to decide on this slide"
      action={<Button>Open the next slide</Button>}
    >
      The AI has no result for tumor_052 yet.
    </InlineState>
  ),
};

export const Toasts: Story = {
  render: () => (
    <div className="grid justify-items-start gap-3">
      <Toast>Comment added on T2. It shows in the full viewer too.</Toast>
      <UndoToast message="T1 marked agree" duration={0} />
      <UndoToast message="Run cancelled" duration={0} />
    </div>
  ),
};

export const SurfaceLevels: Story = {
  render: () => (
    <Surface level="page" className="grid w-[640px] gap-3 rounded-zone p-4">
      <span className="text-caption text-fg-dim">Page</span>
      <Surface level="panel" className="grid gap-3 rounded-zone border border-line p-4">
        <span className="text-caption text-fg-dim">Panel or modal body</span>
        <Surface level="section" className="rounded-zone border border-surf-edge p-4">
          <span className="text-caption text-fg-dim">Section</span>
        </Surface>
        <Surface level="highlight" className="rounded-zone p-4">
          <span className="text-caption text-fg-dim">The part that needs attention now</span>
        </Surface>
      </Surface>
    </Surface>
  ),
};

export const ZoneKinds: Story = {
  render: () => (
    <Surface level="panel" className="w-[560px] rounded-zone p-6">
      <Zones>
        <Zone
          title="Slides"
          sub="3 picked, all with CAMELYON v1.0."
          end={<Button size="sm">Add slides</Button>}
        >
          <Hint>Every reviewer sees the same slides.</Hint>
        </Zone>
        <Zone title="Needs you now" highlight>
          <Hint>Pick at least one reviewer.</Hint>
        </Zone>
        <Zone title="Past its due date" highlight="warn">
          <Hint>The task was due on 18 Oct.</Hint>
        </Zone>
      </Zones>
    </Surface>
  ),
};

export const FoldingZones: Story = {
  render: () => (
    <Surface level="panel" className="grid w-96 gap-3 rounded-zone p-4">
      <FoldingZone title="How objects draw" summary="Outline 2 px · by class · IDs on" defaultOpen>
        <Hint>Draw as, width, opacity and colour.</Hint>
      </FoldingZone>
      <FoldingZone
        title="What the AI shows"
        summary="Confidence as a number · heatmap off · cutoff 0.40"
      >
        <Hint>Confidence, heatmap and cutoff.</Hint>
      </FoldingZone>
      <SectionLabel>Areas, largest first</SectionLabel>
    </Surface>
  ),
};

export const BeforeYouSubmit: Story = {
  render: () => (
    <BeforeYouList
      className="w-96"
      title="Before you submit"
      blockers={[
        { id: "T5", text: "T5 is still open", goTo: "Go to T5" },
        { id: "cells", text: "3 cells in the sample are still open", goTo: "Go to the cells" },
        { id: "q2", text: "Question 2 is not answered", goTo: "Go to the question" },
      ]}
    />
  ),
};

export const BeforeYouSendOne: Story = {
  render: () => (
    <BeforeYouList
      className="w-96"
      title="Before you can send"
      showSingle
      blockers={[
        { id: "due", text: "The due date is in the past. Pick a later day.", goTo: "Go to" },
      ]}
    />
  ),
};

export const ProgressBars: Story = {
  render: () => (
    <div className="grid w-80 gap-4">
      <ProgressBar label="S26-04812_A1_HE.svs" valueText="1.2 of 2.4 GB" value={50} />
      <ProgressBar label="Indexing tiles" valueText="about 2 min left" value={30} tone="tiles" />
      <ProgressBar label="Lenka Malá" valueText="7 of 12" value={58} tone="ok" />
      <ProgressBar label="Jan Růžička" valueText="2 of 12" value={17} tone="warn" />
      <ProgressBar label="Upload" valueText="Failed" value={64} tone="bad" />
    </div>
  ),
};

export const ProgressRings: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <ProgressRing split={{ agree: 0, disagree: 0, unsure: 0, open: 55 }} />
      <ProgressRing split={{ agree: 20, disagree: 6, unsure: 4, open: 25 }} />
      <ProgressRing split={{ agree: 38, disagree: 11, unsure: 6, open: 0 }} size={56} />
    </div>
  ),
};

export const StackedBars: Story = {
  render: () => (
    <div className="grid w-96 gap-4">
      <StackedBar split={{ agree: 0, unsure: 0, disagree: 0 }} />
      <StackedBar split={{ agree: 38, unsure: 6, disagree: 11 }} />
    </div>
  ),
};

export const People: Story = {
  render: () => (
    <div className="grid gap-4">
      <Person person={people.LM} sub />
      <Person person={people.DH} you sub="Researcher" />
      <Person person={people.SM} size={20} short />
      <Person />
      <Person person={people.AK} presence="busy" sub />
      <AvatarStack people={[people.LM, people.SM, people.AK, people.JR, people.TB]} />
      <span className="flex items-center gap-3 text-body-sm">
        <PresenceDot presence="available" /> Available
        <PresenceDot presence="busy" /> Busy until 15:00
        <PresenceDot presence="away" /> Away
      </span>
    </div>
  ),
};
