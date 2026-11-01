import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../src/components/button.tsx";
import { DisplayPanel } from "../src/components/display-panel.tsx";
import { Person } from "../src/components/person.tsx";
import {
  AiRunningSteps,
  ClassCounts,
  ResultSetRows,
  ScoreHistogram,
  SetChip,
  SwipeHandle,
  TileHint,
  ViewPicker,
  VizKey,
  VizLegend,
  VizRamp,
} from "../src/components/visualize.tsx";
import { Zone } from "../src/components/zone.tsx";
import { mockAssets, people } from "./fixtures.ts";

const meta = {
  title: "Components/Visualize",
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

const views = [
  { value: "panel", label: "Objects on the slide" },
  { value: "heat", label: "Heatmap" },
  { value: "density", label: "Cell density" },
  { value: "diff", label: "AI vs reviewed" },
  { value: "models", label: "Model vs model" },
  { value: "readers", label: "Reviewer vs reviewer" },
  { value: "swipe", label: "Swipe between two sets" },
  { value: "table", label: "Object table and stats" },
];

const sets = [
  {
    key: "cam",
    name: "CAMELYON tumor model v1.0",
    sub: "Imported 12 Oct · the result this task checks",
    color: "#f87171",
    fixed: true,
    menu: [
      { icon: "slides" as const, label: "Compare with another set" },
      { icon: "smart" as const, label: "Run a model on this slide" },
      { icon: "upload" as const, label: "Add another result set" },
    ],
  },
  {
    key: "sam",
    name: "PathoSAM + HoVer-NeXt v1.2",
    sub: "Run here 13 Oct",
    color: "#a3e635",
    on: false,
  },
  {
    key: "rev",
    name: "Your review",
    sub: "The reviewed layer, as you edit it",
    color: "#38bdf8",
    on: true,
  },
];

export const HeatmapLegend: Story = {
  render: () => (
    <VizLegend
      kind="Heatmap"
      title="Tumor probability"
      note="Regions T4 and T5 fade out above 0.60."
    >
      <VizRamp ramp="heat" labels={["0", "0.5", "1"]} />
    </VizLegend>
  ),
};

export const DensityLegend: Story = {
  render: () => (
    <VizLegend kind="Density" title="Cells per 0.1 mm²">
      <VizRamp ramp="density" labels={["0", "400", "800+"]} />
    </VizLegend>
  ),
};

export const AiAgainstReviewedLegend: Story = {
  render: () => (
    <VizLegend
      kind="AI vs reviewed"
      title="CAMELYON v1.0 and Reviewed"
      note="Region Dice 0.86 · cells agree 91%"
    >
      <VizKey color="#4ade80" label="AI and reviewer agree" count={4} />
      <VizKey color="#f59e0b" label="AI only, reviewer disagreed" count={2} />
      <VizKey color="#38bdf8" label="Reviewer only, added T6⁺" count={1} />
    </VizLegend>
  ),
};

export const ReviewersLegend: Story = {
  render: () => (
    <VizLegend
      kind="Reviewer vs reviewer"
      title="Two reviewers"
      note="Cohen's kappa 0.71 on regions. Shown only after both submitted."
    >
      <div className="grid gap-1.5">
        <Person person={people.LM} size={20} />
        <Person person={people.SM} size={20} />
      </div>
      <VizKey color="#4ade80" label="Same decision" count={4} />
      <VizKey color="#f59e0b" label="One agrees, one disagrees" count={1} />
      <VizKey color="#f472b6" label="One unsure" count={2} />
    </VizLegend>
  ),
};

function PickerDemo() {
  const [value, setValue] = useState("heat");
  return (
    <Zone title="View" end={<span className="text-caption text-fg-dim">Ways to show results</span>}>
      <ViewPicker views={views} value={value} onValueChange={setValue} />
    </Zone>
  );
}

export const Views: Story = { render: () => <PickerDemo /> };

export const ResultSets: Story = {
  render: () => <ResultSetRows className="w-80" sets={sets} />,
};

export const ScoresAndClasses: Story = {
  render: () => (
    <Zone title="Scores" end={<span className="text-caption text-fg-dim">Regions and cells</span>}>
      <ScoreHistogram bins={[3, 5, 9, 14, 22, 30, 41, 55, 70, 88]} cutoff={0.4} />
      <b className="text-body-sm font-semibold">Per class</b>
      <ClassCounts
        rows={[
          { name: "Tumor", color: "#f87171", count: 9812 },
          { name: "Stroma", color: "#6ee7b7", count: 2201 },
          { name: "Immune", color: "#c084fc", count: 5120 },
          { name: "Other", color: "#fbbf24", count: 1107 },
        ]}
      />
    </Zone>
  ),
};

export const AiStillRunning: Story = {
  render: () => (
    <Zone title="Still reading this slide, 2 regions so far" className="w-80">
      <AiRunningSteps
        steps={[
          { icon: "check", label: "Tissue found, 3 fragments", value: "0:04", state: "done" },
          { icon: "flag", label: "Tumor regions", value: "55%", state: "running", percent: 55 },
          { icon: "eye", label: "Cells, after the regions", value: "queued", state: "queued" },
        ]}
      />
    </Zone>
  ),
};

export const TilesLoading: Story = {
  render: () => (
    <div className="grid w-fit gap-4">
      <TileHint percent={40}>Loading sharper tiles · 12 left</TileHint>
      <TileHint className="w-112" percent={70} action={<Button size="sm">Source status</Button>}>
        <b>Slow source.</b> The scanner archive answers in 2.4 s. Keep reading, the view sharpens as
        tiles arrive. Lower magnifications come first.
      </TileHint>
    </div>
  ),
};

export const Swipe: Story = {
  render: () => (
    <div
      className="relative h-80 w-140 bg-cover bg-center"
      style={{ backgroundImage: `url(${mockAssets.overview})` }}
    >
      <SetChip color="#f87171" className="absolute top-3 left-3">
        A · CAMELYON v1.0
      </SetChip>
      <SetChip color="#a3e635" className="absolute top-3 right-3">
        B · PathoSAM v1.2
      </SetChip>
      <SwipeHandle style={{ left: "52%" }} />
    </div>
  ),
};

export const DisplayInTheViewer: Story = {
  render: () => (
    <div className="w-85">
      <DisplayPanel
        viewer
        folded={["move"]}
        resultSets={<ResultSetRows sets={sets} />}
        after={
          <Zone
            title="View"
            end={<span className="text-caption text-fg-dim">Ways to show results</span>}
          >
            <ViewPicker views={views} value="panel" />
          </Zone>
        }
      />
    </div>
  ),
};

export const DisplayPresetMenuOpen: Story = {
  render: () => (
    <div className="h-120 w-85">
      <DisplayPanel
        viewer
        folded={["ai", "move"]}
        settings={{
          draw: "dots",
          width: "2",
          opacity: 100,
          colorBy: "class",
          ids: false,
          confidence: "word",
          heatmap: 0,
          cutoff: 0.4,
          order: "ai",
          zoom: "fit",
          auto: true,
          buttons: "right",
        }}
        preset={{
          current: "Dots, no IDs",
          presets: [{ name: "Dots, no IDs", key: "⇧2" }],
          defaultOpen: true,
        }}
      />
    </div>
  ),
};
