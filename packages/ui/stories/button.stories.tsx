import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../src/components/button.tsx";
import { Icon } from "../src/components/icon.tsx";
import { Keycap } from "../src/components/keycap.tsx";

const meta = {
  title: "Controls/Button",
  component: Button,
  args: { children: "Accept" },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: "primary", children: "Submit" } };

export const Secondary: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary">Submit</Button>
      <Button>Cancel</Button>
      <Button variant="ghost">Skip for now</Button>
      <Button variant="selected">Picked</Button>
      <Button variant="destructive">Remove</Button>
      <Button variant="link">Open the guide</Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm">Small, 28 px</Button>
      <Button>Default, 32 px</Button>
      <Button size="lg">Large, 40 px</Button>
    </div>
  ),
};

export const WithKeycap: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button>
        Cancel
        <Keycap keys="Esc" size="sm" />
      </Button>
      <Button variant="primary">
        Submit and open slide 9
        <Keycap keys="↵" size="sm" />
      </Button>
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <Button>
      <Icon name="download" />
      Download report
    </Button>
  ),
};

export const IconButtons: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" aria-label="Close">
        <Icon name="close" />
      </Button>
      <Button size="icon-sm" aria-label="More">
        <Icon name="more" />
      </Button>
      <Button size="icon-lg" aria-label="Centre on the selection">
        <Icon name="target" />
      </Button>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Button variant="primary" disabled>
        Submit
      </Button>
      <Button disabled>Cancel</Button>
    </div>
  ),
};
