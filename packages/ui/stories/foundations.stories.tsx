import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../src/components/button.tsx";
import { Keycap } from "../src/components/keycap.tsx";

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
