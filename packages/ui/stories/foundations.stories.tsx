import { type TypeStyle, typeScale, typeStyles } from "@parfocal/tokens";
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

const typeExamples: Record<TypeStyle, { name: string; className: string; example: string }> = {
  label: {
    name: "Label",
    className: "text-label font-semibold uppercase tracking-[0.07em] text-fg-faint",
    example: "AREAS, LARGEST FIRST",
  },
  caption: {
    name: "Caption",
    className: "text-caption",
    example: "Imported 12 Oct from tumor_009_camelyon.geojson",
  },
  "body-sm": {
    name: "Body small",
    className: "text-body-sm",
    example: "Tumor region · 6.2 mm across",
  },
  body: {
    name: "Body",
    className: "text-body",
    example: "Only the largest deposit sets the node's category.",
  },
  lead: { name: "Lead", className: "text-lead", example: "Tumor, 91% sure · 6.2 mm across" },
  "title-sm": { name: "Title small", className: "text-title-sm", example: "Run a model" },
  title: { name: "Title", className: "text-title", example: "Metastasis likely" },
  "page-title": {
    name: "Page title",
    className: "text-page-title",
    example: "Sentinel node AI evaluation",
  },
  display: { name: "Display", className: "text-display", example: "Is T2 tumor?" },
};

const monoExamples = [
  ["ID", "C-2024-0117"],
  ["Number in a column", "6.20 mm  ·  91%"],
  ["File name", "tumor_009_camelyon.geojson"],
  ["Key", "Shift+D"],
] as const;

export const TypeScale: Story = {
  render: () => (
    <div className="grid w-[720px] gap-6 text-fg">
      <div data-testid="type-scale" className="grid">
        {typeStyles.map((style) => {
          const { name, className, example } = typeExamples[style];
          const { size, weight, line } = typeScale[style];
          return (
            <div
              key={style}
              className="grid grid-cols-[150px_1fr] items-baseline gap-4 border-b border-line py-2"
            >
              <small className="grid font-mono text-caption text-fg-faint">
                {name}
                <span className="text-label">
                  {size}/{line} · {weight}
                </span>
              </small>
              <span data-type-style={style} className={className}>
                {example}
              </span>
            </div>
          );
        })}
      </div>
      <div data-testid="type-mono" className="grid gap-1">
        {monoExamples.map(([use, example]) => (
          <div key={use} className="grid grid-cols-[150px_1fr] items-baseline gap-4">
            <small className="text-caption text-fg-faint">{use}</small>
            <span className="font-mono text-body">{example}</span>
          </div>
        ))}
      </div>
    </div>
  ),
};
