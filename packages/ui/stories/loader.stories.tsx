import type { Meta, StoryObj } from "@storybook/react-vite";
import { Loader } from "../src/components/loader.tsx";

const meta = {
  title: "Feedback/Loader",
  component: Loader,
  parameters: { layout: "padded" },
  args: { label: "Loading your home" },
} satisfies Meta<typeof Loader>;

export default meta;

type Story = StoryObj<typeof meta>;

type Variant = {
  name: string;
  size: "inline" | "block";
  still?: boolean;
  theme?: "light" | "dark";
};

function Board({ variants }: { variants: Variant[] }) {
  return (
    <div className="grid gap-6">
      {variants.map((variant) => (
        <section
          key={variant.name}
          data-theme={variant.theme}
          className="grid gap-3 rounded-zone border border-line bg-chrome p-4 text-fg"
        >
          <h3 className="text-body font-semibold">{variant.name}</h3>
          <div className="flex items-center gap-3 text-body-sm text-fg-dim">
            <Loader
              label={`${variant.name} loader`}
              size={variant.size}
              still={variant.still === true}
            />
            <span>{variant.size === "inline" ? "Saving the note" : "Opening the slide"}</span>
          </div>
        </section>
      ))}
    </div>
  );
}

export const Dark: Story = {
  render: () => <Board variants={[{ name: "Dark, block size", size: "block" }]} />,
};

export const Light: Story = {
  render: () => <Board variants={[{ name: "Light, block size", size: "block", theme: "light" }]} />,
};

export const Compact: Story = {
  render: () => <Board variants={[{ name: "Compact, inline size", size: "inline" }]} />,
};

export const ReducedMotion: Story = {
  render: () => (
    <Board variants={[{ name: "Reduced motion, still state", size: "block", still: true }]} />
  ),
};

export const FullPage: Story = {
  parameters: { layout: "fullscreen" },
  render: () => <Loader label="Loading the slide" size="page" />,
};
