import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../src/components/button.tsx";
import { Icon, type IconSize, iconNames } from "../src/components/icon.tsx";
import { Keycap } from "../src/components/keycap.tsx";
import {
  CategoryTag,
  CountBadge,
  FilterChip,
  ObjectIdTag,
  ResultSetTag,
  StatusTag,
} from "../src/components/tag.tsx";

const meta = {
  title: "Components/Foundations",
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

const sizes: IconSize[] = ["xs", "sm", "md", "lg", "xl"];

export const IconSet: Story = {
  render: () => (
    <div className="grid w-[880px] grid-cols-8 gap-3 text-fg">
      {iconNames.map((name) => (
        <div key={name} className="grid justify-items-center gap-1.5 text-caption text-fg-dim">
          <Icon name={name} size="md" className="text-fg" />
          <span>{name}</span>
        </div>
      ))}
    </div>
  ),
};

export const IconSizes: Story = {
  render: () => (
    <div className="flex items-end gap-6 text-fg">
      {sizes.map((size) => (
        <div key={size} className="grid justify-items-center gap-2 text-caption text-fg-dim">
          <Icon name="check" size={size} className="text-fg" />
          <b>{size}</b>
        </div>
      ))}
    </div>
  ),
};

export const IconWithName: Story = {
  render: () => <Icon name="lock" size="md" label="Locked by the task" className="text-fg" />,
};

export const Keycaps: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Keycap keys="K" />
      <Keycap keys="⌘K" />
      <Keycap keys="↵" size="sm" />
      <Keycap keys="X" size="lg" />
      <Button>
        Cancel
        <Keycap keys="Esc" size="sm" />
      </Button>
      <Button variant="primary">
        Submit
        <Keycap keys="↵" size="sm" />
      </Button>
    </div>
  ),
};

export const StatusTags: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <StatusTag>Not started</StatusTag>
      <StatusTag tone="accent">In review</StatusTag>
      <StatusTag tone="ok">Ready to sign off</StatusTag>
      <StatusTag tone="warn">7 disagreements</StatusTag>
      <StatusTag tone="bad">Read error</StatusTag>
      <StatusTag tone="research">Research output</StatusTag>
    </div>
  ),
};

export const CategoryTags: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <CategoryTag>Regions</CategoryTag>
      <CategoryTag>Cells</CategoryTag>
      <CategoryTag>admin</CategoryTag>
      <CategoryTag>Sentinel node staging</CategoryTag>
      <CategoryTag tone="info" icon="link">
        remote
      </CategoryTag>
    </div>
  ),
};

export const ObjectIdTags: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <ObjectIdTag>T2</ObjectIdTag>
      <ObjectIdTag>T1·C145</ObjectIdTag>
      <ObjectIdTag>Z1</ObjectIdTag>
      <ObjectIdTag size="lg">T2</ObjectIdTag>
    </div>
  ),
};

export const ResultSetTags: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <ResultSetTag source="imported">CAMELYON v1.0</ResultSetTag>
      <ResultSetTag source="run">PathoSAM v1.2</ResultSetTag>
      <ResultSetTag>Reviewed live</ResultSetTag>
    </div>
  ),
};

export const CountBadges: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <CountBadge attention title="6 unread">
        6
      </CountBadge>
      <CountBadge attention title="2 open">
        2
      </CountBadge>
      <CountBadge title="61 slides">61</CountBadge>
      <CountBadge title="3 objects">3</CountBadge>
    </div>
  ),
};

export const FilterChips: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <FilterChip defaultPressed>Breast</FilterChip>
      <FilterChip defaultPressed>Lymph nodes</FilterChip>
      <FilterChip>GI</FilterChip>
      <FilterChip>Skin</FilterChip>
    </div>
  ),
};

const typeScale = [
  [
    "Label",
    "text-label font-semibold uppercase tracking-[0.07em] text-fg-faint",
    "AREAS, LARGEST FIRST",
  ],
  ["Caption", "text-caption", "Imported 12 Oct from tumor_009_camelyon.geojson"],
  ["Body small", "text-body-sm", "Tumor region · 6.2 mm across"],
  ["Body", "text-body", "Only the largest deposit sets the node's category."],
  ["Lead", "text-lead", "Tumor, 91% sure · 6.2 mm across"],
  ["Title small", "text-title-sm font-semibold", "Run a model"],
  ["Title", "text-title font-semibold", "Metastasis likely"],
  ["Page title", "text-page-title font-semibold", "Sentinel node AI evaluation"],
  ["Display", "text-display font-semibold", "Is T2 tumor?"],
] as const;

export const TypeScale: Story = {
  render: () => (
    <div className="grid w-[720px] text-fg">
      {typeScale.map(([name, className, example]) => (
        <div
          key={name}
          className="grid grid-cols-[150px_1fr] items-baseline gap-4 border-b border-line py-2"
        >
          <small className="font-mono text-caption text-fg-faint">{name}</small>
          <span className={className}>{example}</span>
        </div>
      ))}
    </div>
  ),
};
