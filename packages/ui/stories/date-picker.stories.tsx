import type { Meta, StoryObj } from "@storybook/react-vite";
import type * as React from "react";
import { useState } from "react";
import { DatePicker } from "../src/components/date-picker.tsx";

const meta = {
  title: "Controls/Date picker",
  component: DatePicker,
  decorators: [
    (Story) => (
      <div className="w-72 min-h-96">
        <Story />
      </div>
    ),
  ],
  args: { today: "2026-10-15" },
} satisfies Meta<typeof DatePicker>;

export default meta;

type Story = StoryObj<typeof meta>;

function Controlled(props: React.ComponentProps<typeof DatePicker>) {
  const [value, setValue] = useState(props.value ?? "");
  return <DatePicker {...props} value={value} onValueChange={setValue} />;
}

export const Empty: Story = { render: (args) => <Controlled {...args} /> };

export const EmptyOpen: Story = {
  render: (args) => <Controlled {...args} defaultOpen />,
};

export const Picked: Story = {
  render: (args) => <Controlled {...args} value="2026-10-23" />,
};

export const PickedOpen: Story = {
  render: (args) => <Controlled {...args} value="2026-10-23" defaultOpen />,
};

export const Disabled: Story = {
  render: (args) => <Controlled {...args} value="2026-10-23" disabled />,
};

export const WithMinDate: Story = {
  render: (args) => <Controlled {...args} min="2026-10-16" defaultOpen />,
};

export const Invalid: Story = {
  render: (args) => <Controlled {...args} value="2026-10-14" invalid />,
};
