import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  BackLink,
  ClassBars,
  CountBar,
  FactList,
  InspectorCard,
  RangeBar,
  RegionRow,
  StagingHero,
  StepBlock,
  WarnBar,
  ZoneRow,
} from "../src/components/inspector.tsx";
import { SectionLabel } from "../src/components/zone.tsx";

const meta = {
  title: "Components/Inspector primitives",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const mockSixDots = [
  { number: 1, mm: 7.7 },
  { number: 2, mm: 1.3 },
  { number: 3, mm: 0.15 },
];

const mockSixRange = {
  min: 0.05,
  max: 20,
  low: 5.9,
  high: 9.4,
  point: 7.7,
  cuts: [0.2, 2],
  dots: mockSixDots,
  number: 1,
};

const shell = "grid w-[340px] gap-4 bg-chrome p-5 text-fg";

export const MockSixStaging: Story = {
  render: () => (
    <div className={shell}>
      <BackLink>Back to the list</BackLink>
      <StagingHero
        title="Metastasis likely"
        category="Macrometastasis"
        sub="Tumor, 94% sure · 7.7 mm across"
        range={mockSixRange}
        count={{ cells: 164 }}
      />
      <WarnBar>The capsule fold may hide extranodal extension.</WarnBar>
    </div>
  ),
};

export const MockSixNotCounted: Story = {
  render: () => (
    <div className={shell}>
      <StagingHero
        title="Metastasis likely"
        category="Macrometastasis"
        sub="Tumor, 94% sure · 7.7 mm across"
        range={mockSixRange}
        count={{ cells: null }}
      />
    </div>
  ),
};

export const MockSixRegions: Story = {
  render: () => (
    <div className={shell}>
      <SectionLabel>Tumor areas</SectionLabel>
      <InspectorCard className="grid gap-1">
        <RegionRow objectId="T1" kind="Tumor area" size="7.7 mm" category="macro" selected />
        <RegionRow objectId="T2" kind="Tumor area" size="1.3 mm" category="micro" visited />
        <RegionRow
          objectId="T3"
          kind="Tumor area"
          size="0.15 mm"
          category="ITC"
          note="Below the micrometastasis line"
        />
      </InspectorCard>
      <ZoneRow objectId="Z1" text="14 unsure cells" pinned />
      <ZoneRow objectId="Z2" text="3 unsure cells" />
    </div>
  ),
};

export const MockSixSteps: Story = {
  render: () => (
    <div className={shell}>
      <StepBlock index={1} title="Is it tumor?" done answer="Yes" />
      <StepBlock index={2} title="How large is the largest deposit?">
        <span className="text-body-sm text-fg-dim">Measure across the widest part.</span>
      </StepBlock>
      <CountBar count={164} />
      <CountBar count={236} />
      <ClassBars
        rows={[
          { name: "Tumor", color: "#f87171", count: 11204 },
          { name: "Stroma", color: "#6ee7b7", count: 4310 },
          { name: "Immune", color: "#c084fc", count: 2290 },
        ]}
      />
    </div>
  ),
};

export const MockSixRangeBar: Story = {
  render: () => (
    <div className={shell}>
      <RangeBar {...mockSixRange} />
    </div>
  ),
};

export const MockSixFacts: Story = {
  render: () => (
    <div className={shell}>
      <FactList
        rows={[
          { icon: "layers", label: "Result set", value: "CAMELYON v1.0, imported 12 Oct" },
          { icon: "flag", label: "Tumor areas", value: "3, 7.7 to 0.15 mm" },
          { icon: "target", label: "Cells", value: "18,240, 50 in your sample" },
        ]}
      />
    </div>
  ),
};
