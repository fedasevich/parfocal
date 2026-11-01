import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../src/components/button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../src/components/dropdown-menu.tsx";

const meta = {
  title: "Controls/Dropdown menu",
  component: DropdownMenu,
} satisfies Meta<typeof DropdownMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

function Example({ open }: { open: boolean }) {
  return (
    <DropdownMenu defaultOpen={open}>
      <DropdownMenuTrigger render={<Button variant="outline" />}>Slide</DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Slide</DropdownMenuLabel>
          <DropdownMenuItem>
            Copy link
            <DropdownMenuShortcut>⌘L</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>Download thumbnail</DropdownMenuItem>
          <DropdownMenuItem disabled>Replace file</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem defaultChecked>Show label image</DropdownMenuCheckboxItem>
          <DropdownMenuItem variant="destructive">Remove from task</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const Closed: Story = {
  render: () => <Example open={false} />,
};

export const Open: Story = {
  render: () => <Example open />,
};
