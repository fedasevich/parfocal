import type { Meta, StoryObj } from "@storybook/react-vite";
import { Ruler } from "lucide-react";
import { Button } from "../src/components/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../src/components/tooltip.tsx";

const meta = {
  title: "Controls/Tooltip",
  component: Tooltip,
} satisfies Meta<typeof Tooltip>;

export default meta;

type Story = StoryObj<typeof meta>;

function Example({ open }: { open: boolean }) {
  return (
    <Tooltip defaultOpen={open}>
      <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="Measure" />}>
        <Ruler />
      </TooltipTrigger>
      <TooltipContent>Measure (M)</TooltipContent>
    </Tooltip>
  );
}

export const Closed: Story = {
  render: () => <Example open={false} />,
};

export const Open: Story = {
  render: () => <Example open />,
};
