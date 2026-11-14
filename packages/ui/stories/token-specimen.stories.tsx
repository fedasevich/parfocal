import {
  classColors,
  colorTokens,
  controlHeightsPx,
  countHeightPx,
  proposalColor,
  radiiPx,
  surfaceSpacingPx,
  tagHeightPx,
} from "@parfocal/tokens";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  title: "Components/Token specimen",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const sizeRows = [
  ...Object.entries(surfaceSpacingPx).map(([name, value]) => [name, value.comfortable] as const),
  ...Object.entries(controlHeightsPx).map(([name, value]) => [`h-${name}`, value] as const),
  ["tag-h", tagHeightPx],
  ["count-h", countHeightPx],
  ...Object.entries(radiiPx).map(([name, value]) => [`r-${name}`, value] as const),
] as const;

export const Specimen: Story = {
  render: () => (
    <div data-testid="token-specimen" className="grid gap-6 bg-surf-page p-6 text-fg">
      <div data-testid="token-colours" className="grid grid-cols-6 gap-3">
        {colorTokens.map((token) => (
          <div key={token} className="grid gap-1">
            <div
              data-token={token}
              className="h-10 rounded-ctl border border-line"
              style={{ background: `var(--${token})` }}
            />
            <small className="font-mono text-caption text-fg-dim">{token}</small>
          </div>
        ))}
      </div>
      <div data-testid="token-classes" className="flex gap-3">
        {Object.entries(classColors).map(([name, value]) => (
          <div
            key={name}
            data-class-colour={name}
            data-value={value}
            className="h-10 w-16 rounded-ctl"
            style={{ background: `var(--c-${name})` }}
          />
        ))}
        <div
          data-class-colour="proposal"
          data-value={proposalColor.stroke}
          className="h-10 w-16 rounded-ctl border-2"
          style={{ background: "var(--c-prop)", borderColor: "var(--c-prop-casing)" }}
        />
      </div>
      <div data-testid="token-sizes" className="grid gap-2">
        {sizeRows.map(([name, value]) => (
          <div key={name} className="flex items-center gap-3">
            <div
              data-size={name}
              data-px={value}
              className="bg-accent-fill"
              style={{ width: value, height: value }}
            />
            <small className="font-mono text-caption text-fg-dim">
              {name} {value}
            </small>
          </div>
        ))}
      </div>
    </div>
  ),
};
