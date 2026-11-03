import type { Meta, StoryObj } from "@storybook/react-vite";
import { AnalysisCards } from "../src/components/analysis-cards.tsx";
import { SidePanel } from "../src/components/side-panel.tsx";
import type { StagingArea, ViewerPartName } from "../src/lib/analysis-parts.ts";

const meta = {
  title: "Components/Analysis cards",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const base: ViewerPartName[] = ["objects", "layers", "decisions", "opinion"];

const areas: StagingArea[] = [
  { object: "T2", size: 1.3 },
  { object: "T1", size: 7.7 },
  { object: "T3", size: 0.15 },
];

function Panel({ parts }: { parts: ViewerPartName[] }) {
  return (
    <div className="flex h-[640px] bg-page text-fg">
      <SidePanel
        head={<AnalysisCards parts={parts} areas={areas} />}
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

export const StagingWithoutAreas: Story = {
  render: () => (
    <div className="flex h-[640px] bg-page text-fg">
      <SidePanel
        head={<AnalysisCards parts={[...base, "staging-hero", "area-list"]} areas={[]} />}
        tabs={[{ value: "objects", label: "Objects", body: <p>Objects list</p> }]}
      />
    </div>
  ),
};
