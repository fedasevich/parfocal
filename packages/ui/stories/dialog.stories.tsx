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

const meta = {
  title: "Controls/Dialog",
  component: Dialog,
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

function Example({ open }: { open: boolean }) {
  return (
    <Dialog defaultOpen={open}>
      <DialogTrigger render={<Button variant="outline" />}>Sign off</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign off this task?</DialogTitle>
          <DialogDescription>
            Signed-off verdicts are locked and go into the evaluation report.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button>Sign off</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const Closed: Story = {
  render: () => <Example open={false} />,
};

export const Open: Story = {
  render: () => <Example open />,
};
