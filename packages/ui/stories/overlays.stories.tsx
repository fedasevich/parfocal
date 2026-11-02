import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../src/components/button.tsx";
import { DrawerPanel } from "../src/components/drawer-panel.tsx";
import { FormField, TextFieldInput } from "../src/components/form-field.tsx";
import {
  type NotificationItem,
  NotificationsPanel,
} from "../src/components/notifications-panel.tsx";
import { SlideSubmittedDialog } from "../src/components/slide-submitted-dialog.tsx";
import { mockAssets } from "./fixtures.ts";

const meta = {
  title: "Components/Overlays",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const none = () => undefined;

const inbox: NotificationItem[] = [
  {
    id: "n1",
    group: "mentions",
    icon: "comment",
    title: "Lenka Malá mentioned you",
    quote: { text: "Is this the capsule?", objectId: "T7", slide: "A1 · H&E" },
    time: "5 min ago",
    read: false,
    action: "Open the comment",
  },
  {
    id: "n2",
    group: "jobs",
    icon: "smart",
    title: "PathoSAM finished on 12 slides",
    detail: "Result set added to the project. 18,246 objects.",
    time: "1 h ago",
    read: false,
    action: "Review the results",
  },
  {
    id: "n3",
    group: "jobs",
    icon: "warn",
    title: "A model run paused",
    detail: "The monthly compute cap is reached. Raise it or wait for the next month.",
    time: "Yesterday",
    read: true,
  },
  {
    id: "n4",
    group: "other",
    icon: "users",
    title:
      "A task with a very long name for the lab study of sentinel lymph nodes was assigned to you",
    detail: "Due in 3 days. 40 slides, 2 reviewers.",
    time: "2 days ago",
    read: true,
  },
];

function PopoverStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-110 overflow-hidden rounded-zone border border-line bg-chrome shadow-pop">
      {children}
    </div>
  );
}

export const NotificationsUnread: Story = {
  render: () => (
    <PopoverStage>
      <NotificationsPanel items={inbox} onOpen={none} onMarkAllRead={none} onClose={none} />
    </PopoverStage>
  ),
};

export const NotificationsAllRead: Story = {
  render: () => (
    <PopoverStage>
      <NotificationsPanel
        items={inbox.map((item) => ({ ...item, read: true }))}
        onOpen={none}
        onMarkAllRead={none}
        onClose={none}
      />
    </PopoverStage>
  ),
};

export const NotificationsEmpty: Story = {
  render: () => (
    <PopoverStage>
      <NotificationsPanel items={[]} onOpen={none} onMarkAllRead={none} onClose={none} />
    </PopoverStage>
  ),
};

export const NotificationsMany: Story = {
  render: () => (
    <PopoverStage>
      <NotificationsPanel
        items={Array.from({ length: 24 }, (_, index) => index).flatMap((index) => {
          const base = inbox[index % inbox.length];
          return base ? [{ ...base, id: `many-${index}` }] : [];
        })}
        onOpen={none}
        onMarkAllRead={none}
        onClose={none}
      />
    </PopoverStage>
  ),
};

function DrawerStage({ children }: { children: React.ReactNode }) {
  return <div className="relative h-130 w-190 overflow-hidden bg-page">{children}</div>;
}

export const DrawerWithFooter: Story = {
  render: () => (
    <DrawerStage>
      <DrawerPanel
        label="New project"
        title="New project"
        hint="P08 when created"
        width={420}
        onClose={none}
        footer={
          <>
            <span className="flex-1" />
            <Button>Cancel</Button>
            <Button variant="primary">Create project</Button>
          </>
        }
      >
        <FormField label="Name">
          <TextFieldInput defaultValue="Sentinel node study" />
        </FormField>
        <FormField label="Description" help="A line for the project list.">
          <TextFieldInput defaultValue="" />
        </FormField>
      </DrawerPanel>
    </DrawerStage>
  ),
};

export const DrawerScrollingBody: Story = {
  render: () => (
    <DrawerStage>
      <DrawerPanel
        label="What files work?"
        title="A long title that has to fit next to the close button of the drawer"
        width={420}
        onClose={none}
      >
        <Button>Open the format guide</Button>
        {Array.from({ length: 30 }, (_, index) => index + 1).map((row) => (
          <p key={row} className="m-0 text-body-sm text-fg-dim">
            Row {row}. Whole-slide images as the scanner writes them.
          </p>
        ))}
      </DrawerPanel>
    </DrawerStage>
  ),
};

export const DrawerWithScrim: Story = {
  render: () => (
    <div
      className="relative h-130 w-190 overflow-hidden bg-page"
      style={{ transform: "translateZ(0)" }}
    >
      <DrawerPanel
        scrim
        label="What files work?"
        title="What files work?"
        width={420}
        onClose={none}
      >
        <p className="m-0 text-body-sm text-fg-dim">Whole-slide images up to 20 GB each.</p>
      </DrawerPanel>
    </div>
  ),
};

function SubmittedStage({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative h-100 w-190 overflow-hidden bg-page"
      style={{ transform: "translateZ(0)" }}
    >
      {children}
    </div>
  );
}

export const SlideSubmittedWithNext: Story = {
  render: () => (
    <SubmittedStage>
      <SlideSubmittedDialog
        title="Slide 3 submitted"
        agreement="You and Lenka Malá agree on 41 of 47 objects. You can look at the differences later, or go on."
        next={{
          thumbUrl: mockAssets.overview,
          eyebrow: "Next · slide 4 of 12",
          name: "A4 · H&E · case RT-15",
          meta: "6 regions, 41 cells · about 11 min",
        }}
        primaryLabel="Open slide 4"
        status="Opens by itself in 5 s. Your review can be changed until sign-off."
        onPrimary={none}
        onDiffer={none}
        onBreak={none}
      />
    </SubmittedStage>
  ),
};

export const SlideSubmittedLast: Story = {
  render: () => (
    <SubmittedStage>
      <SlideSubmittedDialog
        title="Slide 12 submitted"
        primaryLabel="Back to My work"
        status="Stays open until you pick. Your review can be changed until sign-off."
        onPrimary={none}
        onDiffer={none}
        onBreak={none}
      />
    </SubmittedStage>
  ),
};
