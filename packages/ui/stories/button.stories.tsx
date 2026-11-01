import type { Meta, StoryObj } from "@storybook/react-vite";
import { Crosshair, Download } from "lucide-react";
import { Button } from "../src/components/button.tsx";

const meta = {
  title: "Controls/Button",
  component: Button,
  args: { children: "Accept" },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Accept</Button>
      <Button variant="secondary">Skip</Button>
      <Button variant="outline">Export</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="destructive">Reject</Button>
      <Button variant="link">Open the guide</Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button>Default</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <Button variant="outline">
      <Download data-icon="inline-start" />
      Download report
    </Button>
  ),
};

export const IconButton: Story = {
  render: () => (
    <Button variant="ghost" size="icon" aria-label="Centre on the selection">
      <Crosshair />
    </Button>
  ),
};

export const Disabled: Story = {
  args: { disabled: true },
};
