import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReviewProgressPopover, SlidesPopover } from "../src/components/review-popovers.tsx";
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
