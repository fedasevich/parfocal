import type { Meta, StoryObj } from "@storybook/react-vite";
import { AnalysisCards } from "../src/components/analysis-cards.tsx";
import { SidePanel } from "../src/components/side-panel.tsx";
import type { AiArea } from "../src/lib/ai-state.ts";
import type { ViewerPartName } from "../src/lib/analysis-parts.ts";

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
