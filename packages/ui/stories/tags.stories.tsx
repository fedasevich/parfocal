import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import {
  CategoryTag,
  CountBadge,
  FilterChip,
  ObjectIdTag,
  ResultSetTag,
  StatusTag,
} from "../src/components/tag.tsx";
import { categoryTones, resultSetSources, statusTones } from "../src/lib/tag-sets.ts";

const meta = {
  title: "Components/Tags",
  decorators: [
    (Story) => (
      <div className="rounded-zone bg-chrome p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const statusWords = {
  neutral: "Not started",
  accent: "In review",
  ok: "Ready to sign off",
  warn: "7 disagreements",
  bad: "Read error",
  research: "Research output",
} as const;

const resultSetNames = {
  imported: "CAMELYON v1.0",
  run: "PathoSAM v1.2",
  reviewed: "Reviewed live",
} as const;

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function BothThemes({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-4">
      {(["dark", "light"] as const).map((theme) => (
        <div
          key={theme}
          data-theme={theme}
          className="flex flex-col gap-3 rounded-zone border border-line bg-chrome p-4 text-fg"
        >
          {children}
        </div>
      ))}
    </div>
  );
}

function EveryTag() {
  return (
    <>
      <Row>
        {statusTones.map((tone) => (
          <StatusTag key={tone} tone={tone}>
            {statusWords[tone]}
          </StatusTag>
        ))}
      </Row>
      <Row>
        <CategoryTag tone={categoryTones[0]}>Regions</CategoryTag>
        <CategoryTag tone={categoryTones[1]} icon="link">
          remote
        </CategoryTag>
      </Row>
      <Row>
        <ObjectIdTag>T1·C145</ObjectIdTag>
        <ObjectIdTag size="lg">T1·C145</ObjectIdTag>
      </Row>
      <Row>
        {resultSetSources.map((source) => (
          <ResultSetTag key={source} source={source}>
            {resultSetNames[source]}
          </ResultSetTag>
        ))}
      </Row>
      <Row>
        <CountBadge attention title="6 unread">
          6
        </CountBadge>
        <CountBadge title="61 slides">61</CountBadge>
      </Row>
      <Row>
        <FilterChip defaultPressed>Breast</FilterChip>
        <FilterChip>GI</FilterChip>
      </Row>
    </>
  );
}

export const StatusTags: Story = {
  render: () => (
    <Row>
      {statusTones.map((tone) => (
        <StatusTag key={tone} tone={tone}>
          {statusWords[tone]}
        </StatusTag>
      ))}
    </Row>
  ),
};

export const CategoryTags: Story = {
  render: () => (
    <Row>
      <CategoryTag>Regions</CategoryTag>
      <CategoryTag>Cells</CategoryTag>
      <CategoryTag>admin</CategoryTag>
      <CategoryTag>Sentinel node staging</CategoryTag>
      <CategoryTag icon="folder">Breast</CategoryTag>
      <CategoryTag tone="info" icon="link">
        remote
      </CategoryTag>
    </Row>
  ),
};

export const ObjectIdTags: Story = {
  render: () => (
    <Row>
      <ObjectIdTag>T2</ObjectIdTag>
      <ObjectIdTag>T1·C145</ObjectIdTag>
      <ObjectIdTag>Z1</ObjectIdTag>
      <ObjectIdTag size="lg">T2</ObjectIdTag>
      <ObjectIdTag size="lg">T1·C145</ObjectIdTag>
    </Row>
  ),
};

export const CopyableObjectIdTags: Story = {
  render: () => (
    <Row>
      <ObjectIdTag copyText="P07/S26-04812/A1/T2.C145">T2·C145</ObjectIdTag>
      <ObjectIdTag size="lg" copyText="P07/~/tcga-0042/T2">
        T2
      </ObjectIdTag>
    </Row>
  ),
};

export const ResultSetTags: Story = {
  render: () => (
    <Row>
      {resultSetSources.map((source) => (
        <ResultSetTag key={source} source={source}>
          {resultSetNames[source]}
        </ResultSetTag>
      ))}
    </Row>
  ),
};

export const CountBadges: Story = {
  render: () => (
    <Row>
      <CountBadge attention title="6 unread">
        6
      </CountBadge>
      <CountBadge attention title="2 open">
        2
      </CountBadge>
      <CountBadge title="61 slides">61</CountBadge>
      <CountBadge title="3 objects">3</CountBadge>
    </Row>
  ),
};

export const FilterChips: Story = {
  render: () => (
    <Row>
      <FilterChip defaultPressed>Breast</FilterChip>
      <FilterChip defaultPressed>Lymph nodes</FilterChip>
      <FilterChip>GI</FilterChip>
      <FilterChip>Skin</FilterChip>
    </Row>
  ),
};

export const EveryTypeAndToneInBothThemes: Story = {
  render: () => (
    <BothThemes>
      <EveryTag />
    </BothThemes>
  ),
};
