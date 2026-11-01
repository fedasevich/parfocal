import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { BeforeYouList } from "../src/components/before-you-list.tsx";
import { Button } from "../src/components/button.tsx";
import { FlowBar, FlowPage, Stepper, SummaryRows } from "../src/components/flow-page.tsx";
import { FormField, TextFieldInput } from "../src/components/form-field.tsx";
import { Icon } from "../src/components/icon.tsx";
import { Keycap } from "../src/components/keycap.tsx";
import { SegmentedControl } from "../src/components/segmented-control.tsx";
import { SmallModal, SmallModalZone } from "../src/components/small-modal.tsx";
import { TokenField } from "../src/components/token-field.tsx";
import { Hint, Zone } from "../src/components/zone.tsx";
import { people } from "./fixtures.ts";

const meta = {
  title: "Components/Modals and flow pages",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const nudgeMessage =
  "Hi Jan, RT-14 is due on 24 Oct and 10 slides are still to review. Can you get to them this week?";

export const Nudge480: Story = {
  render: () => (
    <SmallModal
      defaultOpen
      trigger={<Button>Nudge</Button>}
      title="Nudge Jan Růžička"
      subtitle="RT-14 · Sentinel node AI evaluation · 2 of 12 done"
      hint="Jan gets it in the app and by email."
      primaryLabel="Send"
    >
      <SmallModalZone>
        <FormField label="Message" count={`${nudgeMessage.length} of 300`}>
          <textarea
            aria-label="Message"
            rows={4}
            defaultValue={nudgeMessage}
            className="w-full resize-y rounded-ctl border border-line-strong bg-surf-field px-2.5 py-2 text-body-sm leading-[1.45] text-fg outline-none focus:border-accent"
          />
        </FormField>
      </SmallModalZone>
    </SmallModal>
  ),
};

export const Reassign560: Story = {
  render: () => (
    <SmallModal
      defaultOpen
      width={560}
      trigger={<Button>Reassign</Button>}
      title="Reassign slides"
      subtitle="Jan Růžička · RT-14 · 2 of 12 done"
      hint="Decisions already made stay with their author."
      primaryLabel="Reassign 10 slides"
    >
      <SmallModalZone title="Which slides">
        <SegmentedControl
          aria-label="Which slides"
          defaultValue="rest"
          options={[
            { value: "rest", label: "The 10 not started" },
            { value: "all", label: "All 12" },
          ]}
        />
      </SmallModalZone>
      <SmallModalZone title="To whom">
        <TokenField
          label="Reviewer"
          items={[{ id: "TB", name: people.TB.name, sub: people.TB.role, person: people.TB }]}
          picked={["TB"]}
        />
      </SmallModalZone>
    </SmallModal>
  ),
};

export const OneBlocker: Story = {
  render: () => (
    <SmallModal
      defaultOpen
      trigger={<Button>Send to an adjudicator</Button>}
      title="Send to an adjudicator"
      subtitle="3 objects from RT-14"
      primaryLabel="Send 3 objects"
      blockers={[{ id: "who", text: "Pick an adjudicator first", goTo: "Go to the field" }]}
    >
      <SmallModalZone>
        <TokenField label="Adjudicator" items={[]} picked={[]} />
      </SmallModalZone>
    </SmallModal>
  ),
};

export const BlockerList: Story = {
  render: () => (
    <SmallModal
      defaultOpen
      width={560}
      trigger={<Button>Sign off</Button>}
      title="Sign off RT-14"
      subtitle="Sentinel node AI evaluation · 12 slides"
      primaryLabel="Sign with the institution's SSO"
      blockersTitle="Before you can sign off"
      blockers={[
        { id: "rev", text: "2 reviews are still missing", goTo: "Go to Team" },
        { id: "dis", text: "3 disagreements are still open", goTo: "Go to the queue" },
      ]}
    >
      <SmallModalZone title="What you sign">
        <Hint>The answers become read-only. A change after this needs a reason and starts v2.</Hint>
      </SmallModalZone>
    </SmallModal>
  ),
};

export const Busy: Story = {
  render: () => (
    <SmallModal
      defaultOpen
      trigger={<Button>Save a preset</Button>}
      title="Save a preset"
      primaryLabel="Save"
      primaryBusy
    >
      <SmallModalZone>
        <FormField label="Name" error="You already have a preset called Tumor first.">
          <TextFieldInput defaultValue="Tumor first" />
        </FormField>
      </SmallModalZone>
    </SmallModal>
  ),
};

const taskSteps = [
  { label: "Slides" },
  { label: "Reviewers" },
  { label: "What to check" },
  { label: "How it runs" },
  { label: "Send" },
];

function TaskFlow({ start }: { start: number }) {
  const [current, setCurrent] = useState(start);
  const last = current === taskSteps.length - 1;
  return (
    <FlowPage
      className="h-[720px]"
      crumbs={[
        { label: "P07 · Sentinel nodes" },
        { label: "Review tasks" },
        { label: "New review task" },
      ]}
      title="New review task"
      subtitle="Ask reviewers to check one result set on the slides you pick."
      steps={taskSteps}
      current={current}
      onStepSelect={setCurrent}
      moreBelow={!last}
      bar={
        <FlowBar
          back={
            current > 0 ? (
              <Button onClick={() => setCurrent(current - 1)}>
                <Icon name="back" />
                Back
              </Button>
            ) : null
          }
          hint={last ? "Reviewers get it in My work." : "Leaving keeps the draft."}
          next={
            <Button
              variant="primary"
              onClick={() => setCurrent(Math.min(taskSteps.length - 1, current + 1))}
            >
              {last ? "Send to 3 reviewers" : "Next"}
              <Keycap keys="↵" size="sm" />
            </Button>
          }
        />
      }
    >
      {last ? (
        <Zone title="Check and send">
          <SummaryRows
            rows={[
              { label: "Slides", value: "12 slides with CAMELYON v1.0" },
              { label: "Reviewers", value: "Lenka Malá, Simona Marková, Jan Růžička" },
              { label: "What to check", value: "Regions and 50 sampled cells, 5-point certainty" },
              { label: "How it runs", value: "Blind, due 24 Oct, everyone reviews every slide" },
            ]}
          />
        </Zone>
      ) : (
        <>
          <Zone title={taskSteps[current]?.label} sub="Every reviewer sees the same slides.">
            <Hint>The zones of this step go here.</Hint>
          </Zone>
          <Zone title="Study template">
            <Hint>Sentinel node AI evaluation v3</Hint>
          </Zone>
        </>
      )}
    </FlowPage>
  );
}

export const FlowFirstStep: Story = { render: () => <TaskFlow start={0} /> };
export const FlowMiddleStep: Story = { render: () => <TaskFlow start={2} /> };
export const FlowLastStep: Story = { render: () => <TaskFlow start={4} /> };

export const StepperOnly: Story = {
  render: () => (
    <div className="p-6">
      <Stepper
        steps={[
          { label: "Findings" },
          { label: "Staging", state: "warn" },
          { label: "Report text" },
          { label: "Sign out" },
        ]}
        current={2}
      />
    </div>
  ),
};

export const FlowBarWithBlockers: Story = {
  render: () => (
    <div className="mx-auto max-w-208 border-t border-line bg-surf-panel px-9">
      <FlowBar
        blockers={
          <BeforeYouList
            title="Before you can sign out"
            blockers={[
              { id: "f", text: "The final diagnosis is empty", goTo: "Go to the field" },
              { id: "d", text: "A deposit has no size yet", goTo: "Go to the deposit" },
            ]}
          />
        }
        back={<Button>Back</Button>}
        next={
          <Button variant="primary" disabled>
            Sign out
          </Button>
        }
      />
    </div>
  ),
};
