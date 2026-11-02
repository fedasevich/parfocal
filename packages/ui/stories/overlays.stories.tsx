import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { type AccountEntry, AccountMenu } from "../src/components/account-menu.tsx";
import { BrightnessPopover } from "../src/components/brightness-popover.tsx";
import { Button } from "../src/components/button.tsx";
import { CommandPaletteView, type PaletteCommand } from "../src/components/command-palette.tsx";
import { DrawerPanel } from "../src/components/drawer-panel.tsx";
import { DropOverlay } from "../src/components/drop-overlay.tsx";
import { FormField, TextFieldInput } from "../src/components/form-field.tsx";
import {
  type NotificationItem,
  NotificationsPanel,
} from "../src/components/notifications-panel.tsx";
import { PreviewOverlay } from "../src/components/preview-overlay.tsx";
import { SlideSubmittedDialog } from "../src/components/slide-submitted-dialog.tsx";
import { mockAssets, people } from "./fixtures.ts";

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

const commands: PaletteCommand[] = [
  { id: "new", group: "Actions", icon: "plus", label: "New task", keys: "N", run: none },
  { id: "run", group: "Actions", icon: "smart", label: "Run a model on a slide", run: none },
  { id: "my", group: "Go to", icon: "folder", label: "My work", run: none },
  {
    id: "long",
    group: "Go to",
    icon: "slides",
    label: "Sentinel lymph node 2, left axilla, level 3 · H&E · P07",
    run: none,
  },
  {
    id: "keys",
    group: "Settings",
    icon: "keyboard",
    label: "Keyboard shortcuts",
    keys: "?",
    run: none,
  },
];

const paletteGroups = ["Actions", "Go to", "Settings"];

function PaletteStage({
  query,
  list,
  current,
}: {
  query: string;
  list: PaletteCommand[];
  current: number;
}) {
  const [text, setText] = useState(query);
  const [at, setAt] = useState(current);
  return (
    <div className="w-160 overflow-hidden rounded-zone border border-line bg-chrome shadow-pop">
      <CommandPaletteView
        query={text}
        onQueryChange={setText}
        commands={list}
        groups={paletteGroups}
        current={at}
        onCurrentChange={setAt}
        onKeyDown={none}
      />
    </div>
  );
}

export const CommandPaletteAll: Story = {
  render: () => <PaletteStage query="" list={commands} current={0} />,
};

export const CommandPaletteFiltered: Story = {
  render: () => (
    <PaletteStage query="node" list={commands.filter((item) => item.id === "long")} current={0} />
  ),
};

export const CommandPaletteNothingMatches: Story = {
  render: () => <PaletteStage query="zzz" list={[]} current={0} />,
};

const accountEntries: AccountEntry[] = [
  { icon: "gear", label: "Settings", keys: "⌘," },
  { icon: "keyboard", label: "Keyboard shortcuts", keys: "?" },
  { icon: "lock", label: "Lock the screen", keys: "⌃⌘Q" },
];

function AccountStage({ initialsOnly, jobTitle }: { initialsOnly: boolean; jobTitle: string }) {
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [only, setOnly] = useState(initialsOnly);
  return (
    <div className="h-110 w-90 text-right">
      <AccountMenu
        defaultOpen
        person={{ ...people.LM, role: jobTitle }}
        organisation="Institute of Pathology, University Hospital"
        presence={{
          key: "available",
          label: "Available",
          hint: "Researchers can give you review tasks",
          tone: "bg-ok",
        }}
        onNextPresence={none}
        theme={theme}
        onThemeChange={setTheme}
        initialsOnly={only}
        onInitialsOnlyChange={setOnly}
        entries={accountEntries}
      />
    </div>
  );
}

export const AccountMenuOpen: Story = {
  render: () => <AccountStage initialsOnly={false} jobTitle="Consultant · breast, nodes" />,
};

export const AccountMenuLongRoleInitialsOnly: Story = {
  render: () => (
    <AccountStage
      initialsOnly
      jobTitle="Consultant pathologist, breast and lymph node diagnostics, second reader for the lab"
    />
  ),
};

export const DropOverlayWithFiles: Story = {
  render: () => (
    <div className="relative h-90 w-190 bg-page">
      <DropOverlay projectCode="P07" slides={12} results={3} onDrop={none} />
    </div>
  ),
};

export const DropOverlayOnlyResults: Story = {
  render: () => (
    <div className="relative h-90 w-190 bg-page">
      <DropOverlay projectCode="P07" slides={0} results={2} onDrop={none} />
    </div>
  ),
};

export const PreviewOverlayOpen: Story = {
  render: () => (
    <div className="relative h-100 w-190 overflow-hidden" style={{ transform: "translateZ(0)" }}>
      <PreviewOverlay
        label="Preview of the report"
        title="S26-04812_draft.pdf"
        meta="A4 · draft, from what you typed"
        closeLabel="Close the preview"
        onClose={none}
      >
        <div className="h-130 w-100 bg-white p-6 text-black">A4 page</div>
      </PreviewOverlay>
    </div>
  ),
};

function BrightnessStage({ start }: { start: number }) {
  const [value, setValue] = useState(start);
  return (
    <div className="flex h-60 w-90 justify-end">
      <BrightnessPopover defaultOpen value={value} onValueChange={setValue} />
    </div>
  );
}

export const BrightnessDefault: Story = {
  render: () => <BrightnessStage start={100} />,
};

export const BrightnessChanged: Story = {
  render: () => <BrightnessStage start={65} />,
};

export const BrightnessAtLimit: Story = {
  render: () => <BrightnessStage start={140} />,
};
