import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  type FindingsCell,
  FindingsPanel,
  type FindingsPanelZone,
} from "../src/components/findings-panel.tsx";
import { Hint } from "../src/components/zone.tsx";
import { plainTyper } from "../src/lib/ai-state.ts";
import {
  CHANGED_ZONE_ID,
  CHANGED_ZONE_NAME,
  type FindingsSelection,
  nothingSelected,
  type StagingPanelArea,
} from "../src/lib/findings-layout.ts";
import type { ModelWarning } from "../src/lib/model-warnings.ts";
import type { NumberLineClass } from "../src/lib/number-line.ts";
import { mockAssets } from "./fixtures.ts";

const meta = {
  title: "Components/Findings panel",
  decorators: [
    (Story) => (
      <div className="w-[360px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const slideClasses: NumberLineClass[] = [
  { name: "Tumor", color: "#f87171", sure: 11190, unsure: 14, checked: 30 },
  { name: "Stroma", color: "#6ee7b7", sure: 4300, unsure: 10, checked: 0 },
  { name: "Immune", color: "#c084fc", sure: 2290, unsure: 0, checked: 5 },
];

const zoneClasses: NumberLineClass[] = [
  { name: "Tumor", color: "#f87171", sure: 38, unsure: 16, checked: 4 },
  { name: "Immune", color: "#c084fc", sure: 12, unsure: 10, checked: 0 },
];

const outlineClasses: NumberLineClass[] = [
  { name: "Tumor", color: "#f87171", sure: 210, unsure: 6, checked: 0 },
  { name: "Stroma", color: "#6ee7b7", sure: 95, unsure: 2, checked: 0 },
];

const tiles = (prefix: string, count: number, decided = 0): FindingsCell[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index + 1}`,
    label: "tumor cell",
    ...(index < decided ? { decision: "agree" as const } : {}),
  }));

const zones: FindingsPanelZone[] = [
  {
    id: "zone-1",
    name: "Models disagree",
    cells: 120,
    unsure: 12,
    open: 12,
    classes: zoneClasses,
    tiles: tiles("C1", 12),
  },
  {
    id: "zone-2",
    name: "Possibly not cells",
    cells: 80,
    unsure: 26,
    open: 20,
    classes: zoneClasses,
    tiles: tiles("C2", 8, 2),
  },
];

const changed: FindingsPanelZone = {
  id: CHANGED_ZONE_ID,
  name: CHANGED_ZONE_NAME,
  cells: 6,
  unsure: 6,
  open: 6,
  classes: zoneClasses,
  tiles: tiles("C9", 6),
};

const warnings: ModelWarning[] = [
  { kind: "uncalibrated", text: "The cell typer is not calibrated on this stain." },
];

const extras = [
  {
    id: "track-record",
    title: "Track record",
    summary: "92% right on 400 checked cells",
    body: <Hint>Measured on slides checked by reviewers.</Hint>,
  },
  {
    id: "calibration",
    title: "Calibration",
    summary: "Checked on held-out slides",
    body: <Hint>Confident calls were right 95% of the time.</Hint>,
  },
];

const cellCall = {
  calls: [
    { label: "tumor", probability: 0.52 },
    { label: "immune", probability: 0.44 },
  ],
  typer: plainTyper,
  wording: "words" as const,
};

type CellDemoProps = {
  start?: FindingsSelection;
  learned?: boolean;
  outlined?: boolean;
  warned?: boolean;
  hovered?: boolean;
};

function CellDemo({
  start = nothingSelected,
  learned = false,
  outlined = false,
  warned = false,
  hovered = false,
}: CellDemoProps) {
  const [selection, setSelection] = useState(start);
  const [kept, setKept] = useState(learned);
  return (
    <FindingsPanel
      layout="cell-findings"
      image={mockAssets.hpf}
      slide={{ label: "This slide", classes: slideClasses }}
      selection={selection}
      onSelect={setSelection}
      zones={zones}
      scattered={tiles("S", 5)}
      outline={outlined ? { id: "R1", name: "Invasive front", classes: outlineClasses } : undefined}
      changed={kept ? changed : undefined}
      onUndoChanged={() => setKept(false)}
      cellCall={cellCall}
      extras={extras}
      hovered={
        hovered ? { id: "zone-2", numbers: "26 unsure of 80 cells (33%), 20 open" } : undefined
      }
      warnings={warned ? warnings : []}
    />
  );
}

const stagingAreas: StagingPanelArea[] = [
  { id: "T1", size: 6.2, low: 4.8, high: 7.1, call: null },
  { id: "T2", size: 0.18, low: 0.14, high: 0.22, call: null, cells: { low: 150, high: 240 } },
];

function StagingDemo({ start = "T1", warned = false }: { start?: string; warned?: boolean }) {
  const [areas, setAreas] = useState(stagingAreas);
  const [current, setCurrent] = useState<string | null>(start);
  const patch = (id: string, change: Partial<StagingPanelArea>) =>
    setAreas((list) => list.map((area) => (area.id === id ? { ...area, ...change } : area)));
  return (
    <FindingsPanel
      layout="node-staging"
      areas={areas}
      current={current}
      onPickArea={(id) => setCurrent((open) => (open === id ? null : id))}
      onCall={(id, call) => patch(id, { call })}
      onMeasure={(id) => patch(id, { measured: id === "T2" ? 0.19 : 6.4 })}
      onCount={(id) => patch(id, { counted: 164 })}
      warnings={warned ? warnings : []}
    />
  );
}

export const NothingSelected: Story = { render: () => <CellDemo hovered /> };

export const ZoneOpen: Story = {
  render: () => <CellDemo start={{ kind: "zone", id: "zone-2" }} />,
};

export const CellSelected: Story = {
  render: () => <CellDemo start={{ kind: "cell", id: "C23", zoneId: "zone-2" }} />,
};

export const OutlineSelected: Story = {
  render: () => <CellDemo outlined start={{ kind: "outline", id: "R1" }} />,
};

export const AfterLearning: Story = { render: () => <CellDemo learned outlined /> };

export const CellFindingsWarned: Story = { render: () => <CellDemo warned /> };

export const NodeStaging: Story = { render: () => <StagingDemo /> };

export const NodeStagingSmallCluster: Story = { render: () => <StagingDemo start="T2" /> };

export const NodeStagingWarned: Story = { render: () => <StagingDemo warned /> };
