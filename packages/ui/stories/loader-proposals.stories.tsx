import type { Meta, StoryObj } from "@storybook/react-vite";
import { renderToStaticMarkup } from "react-dom/server";
import { loaderProposals } from "../src/components/loader-proposals.tsx";

const meta = {
  title: "Feedback/Loader proposals",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

type Variant = { name: string; sizeClass: string; still?: boolean; theme?: "light" | "dark" };

function markupBytes(index: number): number {
  const proposal = loaderProposals[index];
  if (!proposal) return 0;
  const { Loader } = proposal;
  return new TextEncoder().encode(renderToStaticMarkup(<Loader label="Loading" />)).length;
}

function Board({ variants }: { variants: Variant[] }) {
  return (
    <div className="grid gap-6 text-fg">
      <p className="max-w-[640px] text-body-sm text-fg-dim">
        All five are drawn in SVG and CSS from the design tokens, so none adds a dependency. The
        size shown is the bytes of the rendered markup. The five keyframes are shared and add under
        one kilobyte of CSS.
      </p>
      {variants.map((variant) => (
        <section
          key={variant.name}
          data-theme={variant.theme}
          className="grid gap-3 rounded-zone border border-line bg-chrome p-4"
        >
          <h3 className="text-body font-semibold">{variant.name}</h3>
          <div className="grid grid-cols-5 gap-4">
            {loaderProposals.map((proposal, index) => (
              <figure key={proposal.id} className="grid justify-items-start gap-2">
                <div className={variant.sizeClass}>
                  <proposal.Loader
                    label={`${proposal.name} loader`}
                    still={variant.still === true}
                  />
                </div>
                <figcaption className="text-body-sm">
                  <span className="font-semibold">{proposal.name}</span>
                  <span className="ml-2 font-mono text-fg-dim">{markupBytes(index)} B</span>
                  <span className="mt-1 block max-w-[180px] text-fg-dim">{proposal.idea}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export const Dark: Story = {
  render: () => <Board variants={[{ name: "Dark, block size", sizeClass: "size-12" }]} />,
};

export const Light: Story = {
  render: () => (
    <Board variants={[{ name: "Light, block size", sizeClass: "size-12", theme: "light" }]} />
  ),
};

export const Compact: Story = {
  render: () => <Board variants={[{ name: "Compact, inline size", sizeClass: "size-4" }]} />,
};

export const ReducedMotion: Story = {
  render: () => (
    <Board
      variants={[{ name: "Reduced motion, still state", sizeClass: "size-12", still: true }]}
    />
  ),
};

export const AllVariants: Story = {
  render: () => (
    <Board
      variants={[
        { name: "Dark, block size", sizeClass: "size-12" },
        { name: "Light, block size", sizeClass: "size-12", theme: "light" },
        { name: "Compact, inline size", sizeClass: "size-4" },
        { name: "Reduced motion, still state", sizeClass: "size-12", still: true },
      ]}
    />
  ),
};
