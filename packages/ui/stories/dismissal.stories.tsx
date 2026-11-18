import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { Button } from "../src/components/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../src/components/dialog.tsx";
import { DrawerPanel } from "../src/components/drawer-panel.tsx";
import { FormField, TextFieldInput } from "../src/components/form-field.tsx";
import { JobWindow } from "../src/components/job-window.tsx";
import { SettingsDialog, SettingsNav } from "../src/components/settings-dialog.tsx";
import { Sheet, SheetContent, SheetTitle } from "../src/components/sheet.tsx";
import { SlideSubmittedDialog } from "../src/components/slide-submitted-dialog.tsx";
import { SmallModal } from "../src/components/small-modal.tsx";

const meta = {
  title: "Components/Dismissal",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function Probe({
  children,
}: {
  children: (open: boolean, setOpen: (next: boolean) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="grid gap-3 p-6">
      <p data-testid="state" className="m-0">
        {open ? "open" : "closed"}
      </p>
      <Button onClick={() => setOpen(true)}>Open again</Button>
      {children(open, setOpen)}
    </div>
  );
}

const none = () => undefined;

export const DialogKind: Story = {
  render: () => (
    <Probe>
      {(open, setOpen) => (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Sign off this task?</DialogTitle>
              <DialogDescription>Signed-off decisions are locked.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )}
    </Probe>
  ),
};

export const SheetKind: Story = {
  render: () => (
    <Probe>
      {(open, setOpen) => (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent>
            <SheetTitle>Filters</SheetTitle>
          </SheetContent>
        </Sheet>
      )}
    </Probe>
  ),
};

export const SmallModalKind: Story = {
  render: () => (
    <Probe>
      {(open, setOpen) => (
        <SmallModal
          open={open}
          onOpenChange={setOpen}
          title="Rename the task"
          primaryLabel="Rename"
        >
          <p className="m-0">Pick a new name.</p>
        </SmallModal>
      )}
    </Probe>
  ),
};

export const SmallModalWithUnsavedForm: Story = {
  render: () => (
    <Probe>
      {(open, setOpen) => (
        <SmallModal
          open={open}
          onOpenChange={setOpen}
          dirty
          title="Rename the task"
          primaryLabel="Rename"
        >
          <FormField label="Name">
            <TextFieldInput defaultValue="Study B" />
          </FormField>
        </SmallModal>
      )}
    </Probe>
  ),
};

export const JobWindowKind: Story = {
  render: () => (
    <Probe>
      {(open, setOpen) => (
        <JobWindow
          open={open}
          onOpenChange={setOpen}
          title="CAMELYON tumor model"
          footer={<Button onClick={() => setOpen(false)}>Close, it keeps going</Button>}
        >
          <p className="m-0">Running at 38%.</p>
        </JobWindow>
      )}
    </Probe>
  ),
};

export const SettingsKind: Story = {
  render: () => (
    <Probe>
      {(open, setOpen) => (
        <SettingsDialog
          open={open}
          onOpenChange={setOpen}
          title="Display"
          nav={<SettingsNav query="" onQueryChange={none} />}
        >
          <p className="m-0">Theme</p>
        </SettingsDialog>
      )}
    </Probe>
  ),
};

export const DrawerKind: Story = {
  render: () => (
    <Probe>
      {(open, setOpen) =>
        open ? (
          <DrawerPanel
            scrim
            label="What files work?"
            title="What files work?"
            width={420}
            onClose={() => setOpen(false)}
          >
            <p className="m-0">Whole-slide images up to 20 GB each.</p>
          </DrawerPanel>
        ) : null
      }
    </Probe>
  ),
};

export const SlideSubmittedKind: Story = {
  render: () => (
    <Probe>
      {(open, setOpen) =>
        open ? (
          <SlideSubmittedDialog
            title="Slide 12 submitted"
            primaryLabel="Back to My work"
            status="Stays open until you pick."
            onPrimary={none}
            onDiffer={none}
            onBreak={none}
            onClose={() => setOpen(false)}
          />
        ) : null
      }
    </Probe>
  ),
};
