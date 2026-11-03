import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { DecisionButtons, type DecisionStyle } from "../src/components/decision-buttons.tsx";
import { GalleryTile } from "../src/components/gallery-tile.tsx";
import {
  BackLink,
  CellCrop,
  ClassBars,
  CountBar,
  FactList,
  InspectorCard,
  NumberLine,
  RegionRow,
  StagingHero,
  StepBlock,
  WarnBar,
  ZoneRow,
} from "../src/components/inspector.tsx";
import { ToolRail, ToolRailButton, ToolRailGroup } from "../src/components/tool-rail-button.tsx";
import { tumorShareResultFor } from "../src/lib/tumor-share.ts";
import { mockAssets, projectClasses } from "./fixtures.ts";

const meta = {
  title: "Components/Review",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function Decide({
  decisionStyle,
  size,
}: {
  decisionStyle: DecisionStyle;
  size: "large" | "compact";
}) {
  const [value, setValue] = useState<string | undefined>(undefined);
  return (
    <div className={size === "large" ? "w-[420px]" : "w-[300px]"}>
      <DecisionButtons
        decisionStyle={decisionStyle}
        size={size}
        value={value}
        onValueChange={setValue}
        classes={projectClasses}
        aiClass="Tumor"
        label="Your answer on T2"
      />
    </div>
  );
}

export const CertaintyLarge: Story = {
  render: () => <Decide decisionStyle="certainty" size="large" />,
};
export const CertaintyCompact: Story = {
  render: () => <Decide decisionStyle="certainty" size="compact" />,
};
export const AgreeLarge: Story = { render: () => <Decide decisionStyle="agree" size="large" /> };
export const AgreeCompact: Story = {
  render: () => <Decide decisionStyle="agree" size="compact" />,
};
export const YesNoLarge: Story = { render: () => <Decide decisionStyle="yesno" size="large" /> };
export const YesNoCompact: Story = {
  render: () => <Decide decisionStyle="yesno" size="compact" />,
};
export const BlindLarge: Story = { render: () => <Decide decisionStyle="blind" size="large" /> };
export const BlindCompact: Story = {
  render: () => <Decide decisionStyle="blind" size="compact" />,
};

export const ChosenAnswer: Story = {
  render: () => (
    <div className="w-[420px]">
      <DecisionButtons decisionStyle="agree" value="disagree" label="Your answer on T2" />
    </div>
  ),
};

export const AnswersOff: Story = {
  render: () => (
    <div className="w-[420px]">
      <DecisionButtons decisionStyle="agree" value="agree" disabled label="Your answer on T2" />
    </div>
  ),
};

export const GalleryTiles: Story = {
  render: () => (
    <div className="flex items-end gap-4 bg-chrome p-4">
      <GalleryTile image={mockAssets.hpf} objectId="T1·C145" label="tumor cell" />
      <GalleryTile image={mockAssets.hpf} objectId="T1·C146" label="tumor cell" state="current" />
      <GalleryTile
        image={mockAssets.hpf}
        objectId="T1·C147"
        label="tumor cell"
        state="done"
        decision="agree"
      />
      <GalleryTile
        image={mockAssets.hpf}
        objectId="T1·C148"
        label="tumor cell"
        state="done"
        decision="disagree"
      />
      <GalleryTile
        image={mockAssets.hpf}
        objectId="T1·C149"
        label="tumor cell"
        state="done"
        decision="unsure"
      />
      <GalleryTile
        image={mockAssets.hpf}
        objectId="T1·C150"
        label="tumor cell"
        size={120}
        state="current"
      />
    </div>
  ),
};

export const ToolRailStates: Story = {
  render: () => (
    <div className="flex items-start gap-8">
      <ToolRail className="h-96">
        <ToolRailGroup>
          <ToolRailButton icon="select" label="Select" keyHint="V" defaultPressed />
          <ToolRailButton icon="hand" label="Hand" keyHint="H" />
        </ToolRailGroup>
        <ToolRailGroup>
          <ToolRailButton icon="smart" label="Smart select" keyHint="S" ai />
          <ToolRailButton icon="auto" label="Auto region" keyHint="U" ai />
        </ToolRailGroup>
        <ToolRailGroup>
          <ToolRailButton icon="ruler" label="Ruler" keyHint="L" />
          <ToolRailButton icon="comment" label="Comment" keyHint="C" />
        </ToolRailGroup>
      </ToolRail>
      <div className="flex items-center gap-3 bg-chrome p-3">
        <ToolRailButton icon="select" label="Select" keyHint="V" />
        <ToolRailButton icon="hand" label="Hand" keyHint="H" state="hover" />
        <ToolRailButton icon="ruler" label="Ruler" keyHint="L" defaultPressed />
        <ToolRailButton icon="smart" label="Smart select" keyHint="S" ai />
        <ToolRailButton icon="auto" label="Auto region" keyHint="U" ai defaultPressed />
      </div>
    </div>
  ),
};

export const InspectorPrimitives: Story = {
  render: () => (
    <div className="grid w-[340px] gap-5 bg-chrome p-5 text-fg">
      <BackLink>Back to the list</BackLink>
      <StagingHero
        title="Metastasis likely"
        category="Macrometastasis"
        sub="Tumor, 91% sure · 6.2 mm across"
        range={{ min: 0.1, max: 20, low: 4.8, high: 7.1, point: 6.2, cuts: [0.2, 2] }}
      />
      <WarnBar>The capsule fold may hide extranodal extension.</WarnBar>
      <InspectorCard className="grid gap-1">
        <RegionRow objectId="T1" kind="Tumor region" size="6.2 mm" category="macro" selected />
        <RegionRow objectId="T2" kind="Tumor region" size="1.6 mm" category="micro" />
      </InspectorCard>
      <ClassBars
        rows={[
          { name: "Tumor", color: "#f87171", count: 11204 },
          { name: "Stroma", color: "#6ee7b7", count: 4310 },
          { name: "Immune", color: "#c084fc", count: 2290 },
          { name: "Other", color: "#fbbf24", count: 434 },
        ]}
      />
      <CountBar count={164} />
      <StepBlock index={1} title="Is it tumor?" done answer="Yes" />
      <StepBlock index={2} title="How large is the largest deposit?">
        <span className="text-body-sm text-fg-dim">Measure across the widest part.</span>
      </StepBlock>
      <ZoneRow objectId="Z1" text="14 unsure cells" pinned />
      <NumberLine sure={18224} unsure={14} total={18238} />
      <NumberLine
        sure={18224}
        unsure={14}
        total={18238}
        result={tumorShareResultFor(
          Array.from({ length: 400 }, (_, index) =>
            index < 128
              ? { probability: 0.75, calledTumor: true }
              : { probability: 36 / 272, calledTumor: false },
          ),
          0.2,
        )}
      />
      <div className="flex gap-2">
        <CellCrop image={mockAssets.hpf} objectId="T1·C145" />
        <CellCrop image={mockAssets.hpf} objectId="T1·C146" />
      </div>
      <FactList
        tight
        rows={[
          { icon: "layers", label: "Result set", value: "CAMELYON v1.0, imported 12 Oct" },
          { icon: "flag", label: "Tumor regions", value: "5, 6.2 to 0.4 mm" },
          { icon: "target", label: "Cells", value: "18,240, 50 in your sample" },
        ]}
      />
    </div>
  ),
};
