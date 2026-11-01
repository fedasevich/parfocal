import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../src/components/button.tsx";
import {
  JobSlideList,
  JobSlideRow,
  type JobStep,
  JobStepList,
} from "../src/components/job-steps.tsx";
import { JobWindow } from "../src/components/job-window.tsx";
import { JobRow, JobRowLink, JobsButton, JobsTray, ValueRing } from "../src/components/jobs.tsx";
import { type ModelGroup, ModelPicker, OutcomeRow } from "../src/components/model-picker.tsx";
import { Zone } from "../src/components/zone.tsx";

const meta = {
  title: "Components/Models and jobs",
  decorators: [
    (Story) => (
      <div className="w-[640px] rounded-zone bg-chrome p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const stepNames = [
  "Queued",
  "Tiles read",
  "Tissue found",
  "Model running",
  "Objects placed",
  "IDs given",
  "Result set added",
];

const stepsAt = (at: number, details: string[], current?: Partial<JobStep>): JobStep[] =>
  stepNames.map((label, index) => ({
    label,
    detail: details[index],
    state: index < at ? "done" : index === at && current ? (current.state ?? "current") : "waiting",
    ...(index === at && current ? current : {}),
  }));

export const Rings: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <ValueRing value={0} size={26} stroke={3} text="0" />
      <ValueRing value={21} size={26} stroke={3} text="2" />
      <ValueRing value={62} />
      <JobsButton running={2} percent={21} />
      <JobsButton running={2} percent={21} open />
    </div>
  ),
};

export const TrayBeforeARun: Story = {
  render: () => (
    <JobsTray
      className="rounded-zone border border-line-strong bg-popover"
      running={[
        <JobRow
          key="up"
          icon="upload"
          title="Upload into P07"
          detail="6 slides and 4 result files"
          percent={46}
          valueText="46% · 3 min left"
        />,
        <JobRow
          key="cam"
          icon="smart"
          title="CAMELYON tumor model v1.0"
          detail="tumor_044 · the lab server is busy"
          percent={38}
          valueText="Paused at 38%"
          tone="warn"
          action={<JobRowLink>Resume</JobRowLink>}
        />,
      ]}
      finished={[
        <JobRow
          key="p09"
          icon="upload"
          title="Upload into P09"
          detail="12 slides · today 09:12"
          percent={100}
          valueText="Done"
          tone="ok"
          action={<JobRowLink>Open</JobRowLink>}
        />,
        <JobRow
          key="hov"
          icon="smart"
          title="HoVer-Net v2.1"
          detail="4 slides in P09 · yesterday"
          percent={100}
          valueText="Done"
          tone="ok"
          action={<JobRowLink>Open</JobRowLink>}
        />,
      ]}
    />
  ),
};

export const TrayNothingRunning: Story = {
  render: () => (
    <JobsTray
      className="rounded-zone border border-line-strong bg-popover"
      running={[]}
      finished={[
        <JobRow
          key="hov"
          icon="smart"
          title="HoVer-Net v2.1"
          detail="4 slides in P09 · yesterday"
          percent={100}
          valueText="Done"
          tone="ok"
        />,
      ]}
    />
  ),
};

function SlideRows() {
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true, 1: false });
  const toggle = (index: number) => (next: boolean) => setOpen({ ...open, [index]: next });
  return (
    <JobSlideList>
      <JobSlideRow
        name="tumor_052.tif"
        percent={16}
        valueText="Tiles read"
        stepsDone={1}
        stepsTotal={7}
        open={open[0] ?? false}
        onOpenChange={toggle(0)}
      >
        <JobStepList steps={stepsAt(1, ["one run ahead, 8 min", "9 levels"], { percent: 11 })} />
      </JobSlideRow>
      <JobSlideRow
        name="tumor_060.tif"
        percent={0}
        valueText="Waiting"
        stepsDone={0}
        stepsTotal={7}
        open={open[1] ?? false}
        onOpenChange={toggle(1)}
      >
        <JobStepList steps={stepsAt(0, [])} />
      </JobSlideRow>
    </JobSlideList>
  );
}

export const SlidesRunning: Story = { render: () => <SlideRows /> };

export const SlidePaused: Story = {
  render: () => (
    <JobSlideList>
      <JobSlideRow
        name="tumor_044.tif"
        percent={38}
        valueText="Paused"
        tone="warn"
        stepsDone={3}
        stepsTotal={7}
        open
        onOpenChange={() => undefined}
      >
        <JobStepList
          steps={stepsAt(3, ["", "9 levels", "48 mm²", "tile 448 of 1,180"], {
            state: "held",
            percent: 38,
            valueText: "paused",
          })}
        />
      </JobSlideRow>
    </JobSlideList>
  ),
};

export const SlideDone: Story = {
  render: () => (
    <JobSlideList>
      <JobSlideRow
        name="LN-0141.svs"
        percent={100}
        valueText="Done"
        tone="ok"
        stepsDone={7}
        stepsTotal={7}
        open
        onOpenChange={() => undefined}
      >
        <JobStepList
          steps={stepsAt(7, [
            "",
            "9 levels",
            "61 mm²",
            "all tiles",
            "21,408 cells",
            "C1 to C21408",
            "HoVer-Net v2.1 · 14 Oct",
          ])}
          footer={<Button size="sm">Open the slide</Button>}
        />
      </JobSlideRow>
    </JobSlideList>
  ),
};

const groups: ModelGroup[] = [
  {
    title: "Parfocal models",
    options: [
      {
        id: "cam",
        title: "CAMELYON tumor model",
        description: "Tumor regions and a heatmap",
        makes: ["Regions", "Heatmap"],
        perSlide: "4 min a slide",
      },
      {
        id: "sam",
        title: "PathoSAM + HoVer-NeXt",
        description: "Tumor regions and every cell with a type",
        makes: ["Regions", "Cells"],
        perSlide: "17 min a slide",
      },
    ],
  },
  {
    title: "Your lab's models",
    options: [
      {
        id: "lab",
        title: "Lab HoVer-Net fork",
        description: "Runs on your server, ml.cuailab.cz",
        makes: ["Cells"],
        perSlide: "6 min a slide",
      },
    ],
  },
];

function Picker({ startOpen }: { startOpen: boolean }) {
  const [value, setValue] = useState<string | null>("sam");
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="grid gap-5">
      <ModelPicker
        groups={groups}
        value={value}
        onValueChange={setValue}
        open={open}
        onOpenChange={setOpen}
        note="A run always uses the latest version, and the result set records which one."
      />
      <div className="grid gap-3">
        <OutcomeRow
          icon="layers"
          title="A new result set on each slide"
          detail="Called PathoSAM + HoVer-NeXt · 15 Oct. Result sets you already have stay as they are."
        />
        <OutcomeRow
          icon="calendar"
          title="About 34 min, done around 15:12"
          detail="About 17 min a slide on the Parfocal GPU. One run is ahead of yours, about 8 min."
        />
      </div>
    </div>
  );
}

export const ModelPickerClosed: Story = { render: () => <Picker startOpen={false} /> };

export const ModelPickerOpen: Story = { render: () => <Picker startOpen /> };

export const JobWindowPaused: Story = {
  render: () => (
    <JobWindow
      open
      title="CAMELYON tumor model v1.0 · paused"
      subtitle="P07 · started 08:20 by Daniel Hruška · Paused at 38%"
      footer={
        <>
          <Button variant="ghost">Cancel the run</Button>
          <span className="flex-1" />
          <Button>Close, it keeps going</Button>
        </>
      }
    >
      <Zone
        highlight="warn"
        title="Paused at 38%: the lab server stopped answering"
        sub="ml.cuailab.cz has not answered for 12 minutes. Nothing is lost."
      >
        <div className="flex gap-2">
          <Button variant="primary">Resume now</Button>
          <Button>Move it to the Parfocal GPU</Button>
        </div>
      </Zone>
    </JobWindow>
  ),
};
