import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon, type IconSize, iconLabels, iconNames } from "../src/components/icon.tsx";
import { KeycapBindings } from "../src/components/keycap.tsx";
import { ToolRail, ToolRailButton } from "../src/components/tool-rail-button.tsx";

const meta = {
  title: "Foundations/Icons",
  component: Icon,
  args: { name: "check", size: "sm" },
  decorators: [
    (Story) => (
      <div className="rounded-zone bg-chrome p-5 text-fg">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Icon>;

export default meta;

type Story = StoryObj<typeof meta>;

const sizes: [IconSize, string][] = [
  ["xs", "12 in tags and checkboxes"],
  ["sm", "16 by default"],
  ["md", "20 for navigation, large buttons, tiles and zone headers"],
  ["lg", "24 for drop zones and empty states"],
  ["xl", "40 for state badges"],
];

export const EveryIcon: Story = {
  render: () => (
    <ul className="grid w-[880px] grid-cols-8 gap-3">
      {iconNames.map((name) => (
        <li
          key={name}
          data-icon-cell={name}
          className="grid justify-items-center gap-1.5 text-caption text-fg-dim"
        >
          <Icon name={name} size="md" label className="text-fg" />
          <span>{iconLabels[name]}</span>
        </li>
      ))}
    </ul>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-6">
      {sizes.map(([size, use]) => (
        <div key={size} className="grid w-28 justify-items-center gap-2 text-caption text-fg-dim">
          <Icon name="check" size={size} label className="text-fg" />
          <b>{size}</b>
          <span className="text-center">{use}</span>
        </div>
      ))}
    </div>
  ),
};

export const Colours: Story = {
  render: () => (
    <div className="flex items-center gap-6 text-caption text-fg-dim">
      <span className="flex items-center gap-1.5 text-fg">
        <Icon name="eye" /> Text colour
      </span>
      <span className="flex items-center gap-1.5 text-accent">
        <Icon name="check" /> Selected
      </span>
      <span className="flex items-center gap-1.5">
        <Icon name="warn" label className="text-warn" /> The icon is the status
      </span>
    </div>
  ),
};

export const WithName: Story = {
  render: () => <Icon name="lock" size="md" label="Locked by the task" />,
};

const personal: Record<string, string> = { tselect: "Q", truler: "M", thand: "H" };

export const ToolKeys: Story = {
  render: () => (
    <KeycapBindings label={(action) => personal[action]}>
      <ToolRail>
        <ToolRailButton icon="select" label="Select" action="tselect" />
        <ToolRailButton icon="ruler" label="Ruler" action="truler" />
        <ToolRailButton icon="hand" label="Hand" action="thand" />
      </ToolRail>
    </KeycapBindings>
  ),
};
