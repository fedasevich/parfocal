import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../src/components/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../src/components/dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../src/components/dropdown-menu.tsx";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../src/components/popover.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../src/components/tooltip.tsx";
import { TimedToast } from "../src/components/undo-toast.tsx";

const meta = {
  title: "Components/Overlay states",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const longText =
  "Signed-off decisions are locked for everyone on the task and go into the evaluation report. This note is deliberately long so the layout has to wrap it without growing past the viewport or hiding the buttons.";

const slideNames = Array.from({ length: 24 }, (_, index) => `Sentinel node slide ${index + 1}`);

export const MenuEmpty: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<Button variant="outline" />}>Result sets</DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuItem disabled>No result sets yet</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const MenuManyItems: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<Button variant="outline" />}>Slides</DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-64 w-64">
        {slideNames.map((name) => (
          <DropdownMenuItem key={name}>{name}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const MenuLockedWithReason: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<Button variant="outline" />}>Layer</DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuItem>Show AI cells</DropdownMenuItem>
        <DropdownMenuItem disabled>Edit cells, locked after sign-off</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const PopoverLongText: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button variant="outline" />}>Details</PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>A title that is long enough to wrap onto a second line</PopoverTitle>
          <PopoverDescription>{longText}</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  ),
};

export const PopoverManyItems: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button variant="outline" />}>Slides</PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Slides in this task</PopoverTitle>
        </PopoverHeader>
        <ul aria-label="Slides" className="m-0 grid max-h-52 list-none gap-1 overflow-y-auto p-0">
          {slideNames.map((name) => (
            <li key={name}>
              <Button variant="ghost" size="sm">
                {name}
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  ),
};

export const PopoverLockedWithReason: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button variant="outline" />}>Brightness</PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Brightness</PopoverTitle>
          <PopoverDescription>
            Locked while the slide is shown in the reference colours.
          </PopoverDescription>
        </PopoverHeader>
        <Button disabled>Reset</Button>
      </PopoverContent>
    </Popover>
  ),
};

export const DialogLongText: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="outline" />}>Sign off</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign off this task and lock every decision on it?</DialogTitle>
          <DialogDescription>{longText}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button>Sign off</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const DialogManyItems: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="outline" />}>Open slides</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Slides that still need a decision</DialogTitle>
        </DialogHeader>
        <ul aria-label="Slides" className="m-0 grid max-h-60 list-none gap-1 overflow-y-auto p-0">
          {slideNames.map((name) => (
            <li key={name}>
              <Button variant="ghost" size="sm">
                {name}
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const DialogLockedWithReason: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="outline" />}>Sign off</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign off this task?</DialogTitle>
          <DialogDescription>
            Sign-off is locked. Two slides still have objects without a decision.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled>Sign off</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const TooltipLongText: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger render={<Button variant="outline" />}>Measure</TooltipTrigger>
      <TooltipContent>
        Measure a distance on the slide in micrometres. Click two points, then press Esc to stop.
      </TooltipContent>
    </Tooltip>
  ),
};

export const TooltipDisabledWithReason: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger render={<Button aria-disabled variant="outline" />}>Export</TooltipTrigger>
      <TooltipContent>Export is locked until the task is signed off</TooltipContent>
    </Tooltip>
  ),
};

export const ToastDefault: Story = {
  render: () => <TimedToast message="Link copied" duration={0} />,
};

export const ToastLongText: Story = {
  render: () => <TimedToast message={longText} duration={0} />,
};

export const ToastExpires: Story = {
  render: () => (
    <div className="fixed inset-x-0 bottom-6 flex justify-center">
      <TimedToast message="Link copied" />
    </div>
  ),
};
