import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { ModelWarningsBlock } from "../src/components/model-warnings.tsx";
import { Switch } from "../src/components/switch.tsx";
import { Zones } from "../src/components/zone.tsx";
import {
  modelWarnings,
  type SlideStatistics,
  type TyperMetadata,
} from "../src/lib/model-warnings.ts";

const meta = {
  title: "Components/Model warnings",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const measured: TyperMetadata = {
  name: "HoVer-NeXt",
  calibrated: true,
  testSetAccuracy: 0.83,
  testSetConfidentShare: 0.59,
  testSetUnsureShare: 0.075,
  validatedSites: ["Breast", "Colon", "Lung"],
};

const familiar: SlideStatistics = {
  typedCells: 500,
  confidentShare: 0.55,
  unsureShare: 0.08,
  site: "Breast",
};

const unfamiliar: SlideStatistics = {
  typedCells: 500,
  confidentShare: 0.2,
  unsureShare: 0.4,
  site: "Lymph node",
};

function Inspector({ typer, slide }: { typer: TyperMetadata; slide: SlideStatistics }) {
  const [enabled, setEnabled] = React.useState(true);
  return (
    <div className="w-[340px] bg-surf-panel p-3 text-fg">
      <Zones>
        <label className="flex items-center justify-between gap-2.5 text-body-sm">
          <span>Model warnings</span>
          <Switch
            aria-label="Model warnings"
            checked={enabled}
            onCheckedChange={(value) => setEnabled(value)}
          />
        </label>
        <ModelWarningsBlock warnings={modelWarnings(typer, slide)} enabled={enabled} />
      </Zones>
    </div>
  );
}

export const NoWarning: Story = {
  render: () => <Inspector typer={measured} slide={familiar} />,
};

export const OneWarning: Story = {
  render: () => <Inspector typer={{ ...measured, calibrated: false }} slide={familiar} />,
};

export const SeveralWarnings: Story = {
  render: () => <Inspector typer={{ ...measured, testSetAccuracy: 0.62 }} slide={unfamiliar} />,
};
