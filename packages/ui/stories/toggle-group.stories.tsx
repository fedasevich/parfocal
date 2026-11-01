import type { Meta, StoryObj } from "@storybook/react-vite";
import { Hand, MousePointer2, PenLine } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "../src/components/toggle-group.tsx";

const meta = {
  title: "Controls/Toggle group",
  component: ToggleGroup,
} satisfies Meta<typeof ToggleGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Segmented: Story = {
  render: () => (
    <ToggleGroup aria-label="Overlay" defaultValue={["cells"]} variant="outline" spacing={0}>
      <ToggleGroupItem value="cells">Cells</ToggleGroupItem>
      <ToggleGroupItem value="regions">Regions</ToggleGroupItem>
      <ToggleGroupItem value="heatmap">Heatmap</ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const Icons: Story = {
  render: () => (
    <ToggleGroup aria-label="Tool" defaultValue={["pan"]}>
      <ToggleGroupItem value="select" aria-label="Select">
        <MousePointer2 />
      </ToggleGroupItem>
      <ToggleGroupItem value="pan" aria-label="Pan">
        <Hand />
      </ToggleGroupItem>
      <ToggleGroupItem value="draw" aria-label="Draw">
        <PenLine />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const Disabled: Story = {
  render: () => (
    <ToggleGroup aria-label="Overlay" defaultValue={["cells"]} variant="outline" disabled>
      <ToggleGroupItem value="cells">Cells</ToggleGroupItem>
      <ToggleGroupItem value="regions">Regions</ToggleGroupItem>
    </ToggleGroup>
  ),
};
