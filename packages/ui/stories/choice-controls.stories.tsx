import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ControlRow } from "../src/components/control-row.tsx";
import { NumberStepper } from "../src/components/number-stepper.tsx";
import { RadioGroup, RadioRow } from "../src/components/radio-group.tsx";
import { SegmentedControl } from "../src/components/segmented-control.tsx";
import { Slider } from "../src/components/slider.tsx";
import { Switch } from "../src/components/switch.tsx";

const meta = {
  title: "Controls/Choice controls",
  decorators: [
    (Story) => (
      <div className="w-96 rounded-zone bg-chrome p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const drawOptions = [
  { value: "outline", label: "Outline" },
  { value: "fill", label: "Fill" },
  { value: "dots", label: "Dots" },
];

export const Segmented: Story = {
  render: () => (
    <ControlRow label="Draw as">
      {(labelId) => (
        <SegmentedControl
          aria-labelledby={labelId}
          fill
          defaultValue="outline"
          options={drawOptions}
        />
      )}
    </ControlRow>
  ),
};

export const ToggleRow: Story = {
  render: () => {
    const [on, setOn] = useState(true);
    return (
      <label className="flex cursor-pointer items-center justify-between gap-4 text-body-sm text-fg">
        Show cell outlines
        <Switch checked={on} onCheckedChange={setOn} />
      </label>
    );
  },
};

export const SliderWithValue: Story = {
  render: () => {
    const [value, setValue] = useState(60);
    return (
      <ControlRow label="Opacity">
        {() => (
          <span className="flex items-center gap-3">
            <Slider
              value={value}
              onValueChange={(next: number | readonly number[]) =>
                setValue(typeof next === "number" ? next : (next[0] ?? 0))
              }
              getAriaLabel={() => "Opacity"}
            />
            <output className="min-w-10 text-right font-mono text-body-sm text-fg">{value}%</output>
          </span>
        )}
      </ControlRow>
    );
  },
};

export const Stepper: Story = {
  render: () => (
    <p className="m-0 flex items-center gap-2 text-body-sm text-fg-dim">
      Counts as agree from
      <NumberStepper label="the first answer that agrees" defaultValue={4} min={3} max={5} />
    </p>
  ),
};

export const RadioRows: Story = {
  render: () => (
    <RadioGroup defaultValue="all" aria-label="Split" className="gap-3">
      <RadioRow
        value="all"
        title="Everyone reviews every slide"
        text="Best for agreement between reviewers"
      />
      <RadioRow value="even" title="Split evenly" text="About 4 slides each" />
      <RadioRow value="per" title="Per slide" />
      <RadioRow value="later" title="Decide later" text="Needs at least one reviewer" disabled />
    </RadioGroup>
  ),
};

const reason = "Locked by RT-14: confidence hidden this round";

export const Locked: Story = {
  render: () => (
    <div className="grid gap-4">
      <ControlRow label="Confidence" locked={{ value: "Hidden", reason }} />
      <ControlRow label="Cell outlines" locked={{ value: "On", reason }} />
      <ControlRow label="Opacity" locked={{ value: "60%", reason }} />
      <ControlRow label="Counts as agree from" locked={{ value: "4", reason }} />
    </div>
  ),
};
