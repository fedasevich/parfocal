import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { AnalysisCards } from "../src/components/analysis-cards.tsx";
import { SidePanel } from "../src/components/side-panel.tsx";
import type { AiArea } from "../src/lib/ai-state.ts";
import type { ViewerPartName } from "../src/lib/analysis-parts.ts";
import {
  advanceScan,
  type Scan,
  scanPath,
  scanSummary,
  startScan,
  type TissueMask,
} from "../src/lib/systematic-scan.ts";

const meta = {
  title: "Components/Analysis cards",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const base: ViewerPartName[] = ["objects", "layers", "decisions", "opinion"];

const areas: AiArea[] = [
  { object: "T2", size: 1.3, probability: 0.91 },
  { object: "T1", size: 7.7, probability: 0.68 },
  { object: "T3", size: 0.15, probability: 0.74 },
];

const settledAreas: AiArea[] = areas.map((area) =>
  area.object === "T1" ? { ...area, call: "agree", measured: 8.0 } : area,
);

function Panel({
  parts,
  staged = areas,
  running = false,
}: {
  parts: ViewerPartName[];
  staged?: AiArea[];
  running?: boolean;
}) {
  return (
    <div className="flex h-[640px] bg-page text-fg">
      <SidePanel
        head={
          <AnalysisCards
            parts={parts}
            areas={staged}
            running={running}
            onStart={(object) => {
              document.body.dataset.started = object;
            }}
            onSubmit={() => {
              document.body.dataset.submitted = "yes";
            }}
          />
        }
        tabs={[
          { value: "objects", label: "Objects", body: <p>Objects list</p> },
          { value: "display", label: "Display", body: <p>Layers</p> },
          { value: "comments", label: "Comments", body: <p>Threads</p> },
          { value: "opinion", label: "Opinion", body: <p>Opinion form</p> },
        ]}
      />
    </div>
  );
}

export const SentinelNodeStaging: Story = {
  render: () => <Panel parts={[...base, "staging-hero", "area-list", "measure-step"]} />,
};

export const CellReview: Story = {
  render: () => <Panel parts={[...base, "unsure-zones", "cell-typing"]} />,
};

export const NoTemplate: Story = {
  render: () => <Panel parts={base} />,
};

const tissue: TissueMask = {
  cell: 10,
  rows: ["........", "..###...", ".#####..", "..##....", "........", "......##", "......##"],
};

const tissuePath = scanPath(tissue, { width: 25, height: 15 });

function NoTumorPanel() {
  const [scan, setScan] = useState<Scan | null>(null);
  return (
    <div className="flex h-[640px] bg-page text-fg">
      <SidePanel
        head={
          <AnalysisCards
            parts={[...base, "staging-hero", "area-list"]}
            areas={[]}
            scan={scanSummary(tissue, scan)}
            onScan={() => setScan(scan ? advanceScan(scan) : startScan(tissuePath))}
            onSubmit={() => {
              document.body.dataset.submitted = "yes";
            }}
          />
        }
        tabs={[{ value: "objects", label: "Objects", body: <p>Objects list</p> }]}
      />
    </div>
  );
}

export const StagingWithoutAreas: Story = {
  render: () => <NoTumorPanel />,
};

export const LargeDepositSettled: Story = {
  render: () => (
    <Panel parts={[...base, "staging-hero", "area-list", "measure-step"]} staged={settledAreas} />
  ),
};

export const StagingStillRunning: Story = {
  render: () => (
    <Panel
      parts={[...base, "staging-hero", "area-list", "measure-step"]}
      staged={areas.slice(0, 2)}
      running
    />
  ),
};

const clusterAreas: AiArea[] = [
  { object: "T5", size: 0.18, probability: 0.71 },
  { object: "T6", size: 0.12, probability: 0.58, cells: { low: 20, high: 60 } },
];

const clusterMeasured: AiArea[] = clusterAreas.map((area) =>
  area.object === "T5" ? { ...area, call: "agree", measured: 0.17 } : area,
);

const clusterSettled: AiArea[] = clusterMeasured.map((area) =>
  area.object === "T5" ? { ...area, cells: { low: 150, high: 190 } } : area,
);

const stagingParts: ViewerPartName[] = [...base, "staging-hero", "area-list", "measure-step"];

export const OnlyASmallCluster: Story = {
  render: () => <Panel parts={stagingParts} staged={clusterAreas} />,
};

export const SmallClusterMeasured: Story = {
  render: () => <Panel parts={stagingParts} staged={clusterMeasured} />,
};

export const SmallClusterSettled: Story = {
  render: () => <Panel parts={stagingParts} staged={clusterSettled} />,
};
