import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../src/components/button.tsx";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../src/components/popover.tsx";

const meta = {
  title: "Controls/Popover",
  component: Popover,
} satisfies Meta<typeof Popover>;

export default meta;

type Story = StoryObj<typeof meta>;

function Example({ open }: { open: boolean }) {
  return (
    <Popover defaultOpen={open}>
      <PopoverTrigger render={<Button variant="outline" />}>Brightness</PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Brightness</PopoverTitle>
          <PopoverDescription>
            Changes how the slide looks, never the image data.
          </PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  );
}

export const Closed: Story = {
  render: () => <Example open={false} />,
};

export const Open: Story = {
  render: () => <Example open />,
};
