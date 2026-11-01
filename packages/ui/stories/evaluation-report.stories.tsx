import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  ConfusionMatrix,
  CountBars,
  MetricTiles,
  ReportBlock,
  ReportBlocks,
  ReportFacts,
  ReportLetterhead,
  ReportObjectsTable,
  ReportSheet,
} from "../src/components/evaluation-report.tsx";
import { PdfPreview } from "../src/components/report-templates.tsx";
import { mockAssets } from "./fixtures.ts";

const meta = {
  title: "Components/Evaluation report",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="grid justify-items-center bg-canvas p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const tiles = [
  { value: "0.92", label: "Sensitivity, regions" },
  { value: "0.88", label: "Precision, regions" },
  { value: "0.86", label: "Dice, regions" },
  { value: "0.71", label: "Cohen's κ, reviewers" },
  { value: "91%", label: "Cells agreed" },
];

function Page({ selected, onSelect }: { selected?: string; onSelect?: (id: string) => void }) {
  const pick = (id: string) => (onSelect ? { onSelect: () => onSelect(id) } : {});
  return (
    <ReportSheet page={1} pages={3} footer="RT-14 · Evaluation v1">
      <ReportLetterhead
        lab={{ name: "Fakultní nemocnice Vltava", short: "FV" }}
        kind="Parfocal · research output"
        title="Evaluation report"
        lines={["RT-14 · CAMELYON tumor model v1.0", "Evaluation v1 · signed 15 Oct 2026"]}
      />
      <ReportFacts
        facts={[
          { label: "Project", value: "Sentinel node AI evaluation (P07)" },
          { label: "Task", value: "RT-14 · Round 2" },
          { label: "Model", value: "CAMELYON tumor model v1.0" },
        ]}
      />
      <ReportBlocks>
        <ReportBlock title="Results" selected={selected === "results"} {...pick("results")}>
          <MetricTiles tiles={tiles} />
        </ReportBlock>
        <ReportBlock
          title="Cell types, AI against the consensus"
          selected={selected === "matrix"}
          {...pick("matrix")}
        >
          <ConfusionMatrix
            classes={["Tumor", "Immune", "Stroma", "Other"]}
            counts={[
              [412, 18, 6, 4],
              [21, 388, 12, 9],
              [5, 14, 201, 7],
              [3, 11, 8, 101],
            ]}
            caption="Rows are what the AI said, columns the consensus."
          />
        </ReportBlock>
        <ReportBlock title="Why reviewers disagreed" half>
          <CountBars
            rows={[
              { label: "Wrong cell type", count: 38 },
              { label: "Boundary is off", count: 21 },
            ]}
          />
        </ReportBlock>
        <ReportBlock title="Opinion answers" half>
          <CountBars
            heading="Is the AI result acceptable?"
            rows={[
              { label: "4", count: 12 },
              { label: "5 · sign as is", count: 7 },
            ]}
          />
        </ReportBlock>
        <ReportBlock title="Objects, worst first">
          <ReportObjectsTable
            people={["Lenka Malá", "Simona Marková"]}
            rows={[
              {
                object: "T2",
                what: "Tumor region",
                answers: ["disagree", "agree"],
                thumb: mockAssets.mid,
              },
              { object: "T4", what: "Tumor region", answers: ["unsure", "disagree"] },
            ]}
          />
        </ReportBlock>
      </ReportBlocks>
    </ReportSheet>
  );
}

export const ReportPage: Story = { render: () => <Page /> };

export const ArrangingBlocks: Story = {
  render: function Arranging() {
    const [selected, setSelected] = useState("matrix");
    return <Page selected={selected} onSelect={setSelected} />;
  },
};

export const PanelTiles: Story = {
  render: () => (
    <div className="w-130 rounded-zone bg-surf-panel p-5">
      <MetricTiles tiles={tiles} variant="panel" />
    </div>
  ),
};

export const PdfWithPages: Story = {
  render: function Pdf() {
    const [current, setCurrent] = useState(1);
    return (
      <PdfPreview
        className="h-[680px] w-[900px]"
        title="RT-14_evaluation_v1"
        meta="A4 · portrait · 3 pages"
        pages={3}
        current={current}
        onCurrentChange={setCurrent}
        renderPage={() => <Page />}
        onClose={() => undefined}
      />
    );
  },
};
