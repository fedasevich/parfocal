import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button, type ButtonProps } from "../src/components/button.tsx";
import { Icon } from "../src/components/icon.tsx";
import { IconButton } from "../src/components/icon-button.tsx";
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
      <IconButton icon="close" label="Close" />
      <IconButton icon="more" label="More" size="sm" variant="secondary" />
      <IconButton icon="target" label="Centre on the selection" size="xs" />
      <IconButton icon="download" label="Download report" disabled />
    </div>
  ),
};

const stateRows: { label: string; state?: ButtonProps["state"]; disabled?: boolean }[] = [
  { label: "Default" },
  { label: "Hover", state: "hover" },
  { label: "Pressed", state: "pressed" },
  { label: "Focus", state: "focus" },
  { label: "Disabled", disabled: true },
];

export const States: Story = {
  render: () => (
    <div className="grid grid-cols-[auto_repeat(4,auto)] items-center justify-start gap-x-3 gap-y-2 text-label text-fg-faint">
      <span />
      <span>Primary</span>
      <span>Secondary</span>
      <span>Ghost</span>
      <span>Icon</span>
      {stateRows.map(({ label, state, disabled }) => (
        <div key={label} className="contents">
          <span>{label}</span>
          <Button variant="primary" state={state} disabled={disabled}>
            Submit
            <Keycap keys="↵" size="sm" />
          </Button>
          <Button state={state} disabled={disabled}>
            Cancel
            <Keycap keys="Esc" size="sm" />
          </Button>
          <Button variant="ghost" state={state} disabled={disabled}>
            Skip for now
          </Button>
          <IconButton
            icon="close"
            label={`Close, ${label.toLowerCase()}`}
            state={state}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  ),
};

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div className="flex items-center gap-3">
      <Button variant="primary" onClick={() => setCount((value) => value + 1)}>
        Submit
      </Button>
      <Button disabled onClick={() => setCount((value) => value + 100)}>
        Locked
      </Button>
      <IconButton icon="close" label="Clear the count" onClick={() => setCount(0)} />
      <output aria-live="polite">Pressed {count} times</output>
    </div>
  );
}

export const Interactive: Story = { render: () => <Counter /> };

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
