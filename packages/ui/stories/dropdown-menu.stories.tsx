import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../src/components/button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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

export const RadioSubmenuAndLongText: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<Button variant="outline" />}>Sort</DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort slides by</DropdownMenuLabel>
          <DropdownMenuRadioGroup defaultValue="name">
            <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="date">Scan date</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="locked" disabled>
              Case, locked by the task
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Move to a project</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>P07 · Sentinel node AI evaluation</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem>
          A very long action name that has to wrap or truncate inside the menu width
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
