import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  CaseDetails,
  ReviewProgressPopover,
  SlidesPopover,
} from "../src/components/review-popovers.tsx";
import { ReviewTopBar } from "../src/components/review-top-bar.tsx";
import { mockAssets } from "./fixtures.ts";

const meta = {
  title: "Components/Review popovers",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const split = { agree: 20, disagree: 6, unsure: 4, open: 25 };

const progressBody = (guided: boolean) => (
  <ReviewProgressPopover
    taskCode="RT-14"
    taskName="Round 2 · CAMELYON v1.0"
    taskSub="Sentinel node AI evaluation"
    slideName="A1 · H&E"
    slide={{ ...split, decided: 30, total: 55 }}
    seenPercent={38}
    onWholeSlide={() => undefined}
    position={8}
    slideTotal={12}
    submittedCount={7}
    dueText="Fri 23 Oct"
    timeLeft="about 1 h 20 min"
    guided={guided}
    onPrevious={() => undefined}
    onNext={() => undefined}
  />
);

const slidesBody = (
  <SlidesPopover
    caseTitle="Case S26-04812"
    caseSub="Lymph node · Sentinel node AI evaluation"
    onOpenCase={() => undefined}
    details={{
      project: "Sentinel node AI evaluation",
      caseLabel: "S26-04812",
      specimen: "A · Lymph node, sentinel, left",
      blocks: ["A1", "A2"],
      task: "RT-14 · Round 2 · CAMELYON v1.0",
      researcher: "Demo Researcher",
    }}
    caseSlides={[
      {
        id: "a1",
        name: "A1 · H&E",
        sub: "CAMELYON v1.0 · PathoSAM v1.2",
        thumb: mockAssets.overview,
        resultSets: 3,
        current: true,
        status: { label: "In review", tone: "accent" },
      },
      {
        id: "a2",
        name: "A2 · H&E",
        sub: "Not opened yet",
        thumb: mockAssets.overview,
        resultSets: 1,
        status: { label: "To review", tone: "neutral" },
      },
    ]}
    looseHeading="Loose slides in task RT-14"
    looseSlides={[
      {
        id: "t31",
        name: "tumor_031 · H&E",
        sub: "Submitted 14 Oct, no case attached",
        thumb: mockAssets.overview,
        resultSets: 1,
        status: { label: "Submitted", tone: "ok" },
      },
    ]}
    footer={{
      resultSetsLabel: "Result sets of A1",
      onResultSets: () => undefined,
      onCompare: () => undefined,
      onAddSlides: () => undefined,
    }}
  />
);

const frame = "w-fit rounded-zone border border-line-strong bg-popover p-4.5 shadow-pop";

export const ReviewProgress: Story = {
  render: () => <div className={frame}>{progressBody(false)}</div>,
};

export const ReviewProgressGuided: Story = {
  render: () => <div className={frame}>{progressBody(true)}</div>,
};

export const SlidesInCase: Story = {
  render: () => (
    <div className="w-fit rounded-zone border border-line-strong bg-popover shadow-pop">
      {slidesBody}
    </div>
  ),
};

const detailsFrame = "w-115 rounded-zone border border-line-strong bg-popover shadow-pop";

export const CaseDetailsClinical: Story = {
  render: () => (
    <div className={detailsFrame}>
      <CaseDetails
        details={{
          project: "Demo clinical project",
          caseLabel: "S26-00001",
          specimen: "A · Skin excision, back",
          blocks: ["A1"],
          task: "RT-2 · Second read",
          researcher: "Demo Researcher",
          clinical: true,
          clinicalNote: "Fake note for the demo. Lesion growing over three months.",
        }}
      />
    </div>
  ),
};

export const CaseDetailsMissing: Story = {
  render: () => (
    <div className={detailsFrame}>
      <CaseDetails details={{ clinical: true }} />
    </div>
  ),
};

export const TopBarWithPopovers: Story = {
  render: () => (
    <ReviewTopBar
      mode="full"
      backHref="#my-work"
      taskName="Round 2 · CAMELYON v1.0"
      taskSub="Sentinel node AI evaluation · due 23 Oct"
      slideName="A1 · H&E"
      slideThumb={mockAssets.overview}
      progress={split}
      progressTitle="Slide 8 of 12"
      progressSub="about 1 h 20 min left"
      slidesPopover={slidesBody}
      progressPopover={progressBody(false)}
    />
  ),
};

const ringStates = {
  empty: { split: { agree: 0, disagree: 0, unsure: 0, open: 12 }, position: 1 },
  partial: { split: { agree: 5, disagree: 2, unsure: 1, open: 4 }, position: 8 },
  finished: { split: { agree: 7, disagree: 3, unsure: 2, open: 0 }, position: 12 },
} as const;

function RingTopBar({ state }: { state: keyof typeof ringStates }) {
  const { split: ring, position } = ringStates[state];
  const [opened, setOpened] = useState<number | null>(null);
  const current = opened ?? position;
  const decided = ring.agree + ring.disagree + ring.unsure;
  const total = decided + ring.open;
  return (
    <div className="grid gap-3">
      <ReviewTopBar
        mode="full"
        backHref="#my-work"
        taskName="Round 2 · CAMELYON v1.0"
        taskSub="Sentinel node AI evaluation · due 23 Oct"
        slideName={`Slide ${current}`}
        progress={ring}
        progressTitle={`Slide ${current} of 12`}
        progressSub="about 1 h 20 min left"
        progressPopover={
          <ReviewProgressPopover
            taskCode="RT-14"
            taskName="Round 2 · CAMELYON v1.0"
            taskSub="Sentinel node AI evaluation"
            slideName={`Slide ${current}`}
            slide={{ ...ring, decided, total }}
            position={current}
            slideTotal={12}
            submittedCount={current - 1}
            dueText="Fri 23 Oct"
            timeLeft="about 1 h 20 min"
            onPrevious={current > 1 ? () => setOpened(current - 1) : undefined}
            onNext={current < 12 ? () => setOpened(current + 1) : undefined}
          />
        }
      />
      <output aria-label="Opened slide">{opened === null ? "" : `Slide ${opened}`}</output>
    </div>
  );
}

export const TopBarRingEmpty: Story = { render: () => <RingTopBar state="empty" /> };

export const TopBarRingPartial: Story = { render: () => <RingTopBar state="partial" /> };

export const TopBarRingFinished: Story = { render: () => <RingTopBar state="finished" /> };

const manySlides = Array.from({ length: 14 }, (_, index) => index + 1).map((n) => ({
  id: `m${n}`,
  name: `Sentinel lymph node level ${n}, left axilla, long scanner name · H&E`,
  sub: n === 1 ? "CAMELYON v1.0 · PathoSAM v1.2" : "Not opened yet",
  thumb: mockAssets.overview,
  resultSets: n % 3,
  current: n === 1,
  status: {
    label: n === 1 ? "In review" : "To review",
    tone: n === 1 ? ("accent" as const) : ("neutral" as const),
  },
}));

export const SlidesManyWithLongNames: Story = {
  render: () => (
    <div className="w-fit rounded-zone border border-line-strong bg-popover shadow-pop">
      <SlidesPopover
        caseTitle="Case S26-04812 with a very long case label for the lab study"
        caseSub="Lymph node · Sentinel node AI evaluation"
        onOpenCase={() => undefined}
        caseSlides={manySlides}
        footer={{
          resultSetsLabel: "Result sets of A1",
          onResultSets: () => undefined,
          onCompare: () => undefined,
          onAddSlides: () => undefined,
        }}
      />
    </div>
  ),
};

export const SlidesOneSlideNoLoose: Story = {
  render: () => (
    <div className="w-fit rounded-zone border border-line-strong bg-popover shadow-pop">
      <SlidesPopover
        caseTitle="Case S26-04813"
        caseSub="One slide"
        onOpenCase={() => undefined}
        caseSlides={manySlides.slice(0, 1)}
        footer={{
          resultSetsLabel: "Result sets of A1",
          onResultSets: () => undefined,
          onCompare: () => undefined,
          onAddSlides: () => undefined,
        }}
      />
    </div>
  ),
};
