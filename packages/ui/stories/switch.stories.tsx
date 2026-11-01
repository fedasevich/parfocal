import type { Meta, StoryObj } from "@storybook/react-vite";
import { Switch } from "../src/components/switch.tsx";

const meta = {
  title: "Controls/Switch",
  component: Switch,
  args: { "aria-label": "Show cell outlines" },
} satisfies Meta<typeof Switch>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Off: Story = {};

export const On: Story = {
  args: { defaultChecked: true },
};

export const Disabled: Story = {
  args: { disabled: true, defaultChecked: true },
};

export const WithLabel: Story = {
  render: () => (
    <label className="flex items-center gap-2 text-sm">
      <Switch defaultChecked />
      Show cell outlines
    </label>
  ),
};
