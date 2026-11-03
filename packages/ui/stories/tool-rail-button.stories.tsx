import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ToolRail, ToolRailButton, ToolRailGroup } from "../src/components/tool-rail-button.tsx";

const meta = {
  title: "Controls/Tool rail button",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3 bg-chrome p-3">{children}</div>;
}

export const Default: Story = {
  render: () => (
    <Frame>
      <ToolRailButton icon="select" label="Select" keyHint="V" />
    </Frame>
  ),
};

export const Hover: Story = {
  render: () => (
    <Frame>
      <ToolRailButton icon="hand" label="Hand" keyHint="H" state="hover" />
    </Frame>
  ),
};

export const Active: Story = {
  render: () => (
    <Frame>
      <ToolRailButton icon="ruler" label="Ruler" keyHint="L" defaultPressed />
    </Frame>
  ),
};

export const AiTool: Story = {
  render: () => (
    <Frame>
      <ToolRailButton icon="smart" label="Smart select" keyHint="S" ai />
    </Frame>
  ),
};

export const AiActive: Story = {
  render: () => (
    <Frame>
      <ToolRailButton icon="auto" label="Auto region" keyHint="U" ai defaultPressed />
    </Frame>
  ),
};

export const WithoutKey: Story = {
  render: () => (
    <Frame>
      <ToolRailButton icon="comment" label="Comment" />
    </Frame>
  ),
};

const tools = [
  { value: "select", icon: "select", label: "Select", keyHint: "V", ai: false },
  { value: "hand", icon: "hand", label: "Hand", keyHint: "H", ai: false },
  { value: "smart", icon: "smart", label: "Smart select", keyHint: "S", ai: true },
  { value: "ruler", icon: "ruler", label: "Ruler", keyHint: "L", ai: false },
] as const;

function PickOne() {
  const [tool, setTool] = useState<string>("select");
  return (
    <ToolRail className="h-60">
      <ToolRailGroup>
        {tools.map((entry) => (
          <ToolRailButton
            key={entry.value}
            icon={entry.icon}
            label={entry.label}
            keyHint={entry.keyHint}
            ai={entry.ai}
            pressed={tool === entry.value}
            onPressedChange={() => setTool(entry.value)}
          />
        ))}
      </ToolRailGroup>
    </ToolRail>
  );
}

export const RailPicksOneTool: Story = {
  render: () => <PickOne />,
};
