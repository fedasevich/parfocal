import type { Meta, StoryObj } from "@storybook/react-vite";
import { Slider } from "../src/components/slider.tsx";

const meta = {
  title: "Controls/Slider",
  component: Slider,
  decorators: [
    (Story) => (
      <div className="w-64">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Slider>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { getAriaLabel: () => "Overlay opacity", defaultValue: 60 },
};

export const Range: Story = {
  args: {
    getAriaLabel: (index) => (index === 0 ? "Smallest cell area" : "Largest cell area"),
    defaultValue: [20, 80],
  },
};

export const Disabled: Story = {
  args: { getAriaLabel: () => "Overlay opacity", defaultValue: 60, disabled: true },
};
