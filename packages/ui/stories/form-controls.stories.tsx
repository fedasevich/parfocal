import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ControlRow, LockedReason } from "../src/components/control-row.tsx";
import { CountsAsLine } from "../src/components/counts-as.tsx";
import { FormField, TextFieldInput } from "../src/components/form-field.tsx";
import { LockableRow } from "../src/components/lockable-row.tsx";
import { NumberStepper } from "../src/components/number-stepper.tsx";
import { SegmentedControl } from "../src/components/segmented-control.tsx";
import { TokenField, type TokenItem } from "../src/components/token-field.tsx";
import { mockAssets, people } from "./fixtures.ts";

const meta = {
  title: "Components/Form controls",
  decorators: [
    (Story) => (
      <div className="rounded-zone bg-chrome p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const drawOptions = [
  { value: "outline", label: "Outline" },
  { value: "fill", label: "Fill" },
  { value: "dots", label: "Dots" },
];

export const Segmented: Story = {
  render: () => (
    <div className="grid w-96 gap-4">
      <SegmentedControl aria-label="Draw as" defaultValue="outline" options={drawOptions} />
      <SegmentedControl
        aria-label="Draw as, filling the row"
        fill
        defaultValue="fill"
        options={drawOptions}
      />
      <SegmentedControl
        aria-label="Answer"
        size="lg"
        fill
        defaultValue="4"
        options={["1", "2", "3", "4", "5"].map((value) => ({ value, label: value }))}
      />
      <SegmentedControl
        aria-label="Confidence"
        defaultValue="number"
        options={[
          { value: "number", label: "Number" },
          { value: "word", label: "Word" },
          { value: "hidden", label: "Hidden", disabled: true },
        ]}
      />
    </div>
  ),
};

export const Stepper: Story = {
  render: () => (
    <NumberStepper label="the first answer that agrees" defaultValue={4} min={3} max={5} />
  ),
};

export const CountsAsCertainty: Story = {
  render: () => {
    const [range, setRange] = useState({ agreeFrom: 4, disagreeTo: 2 });
    return (
      <CountsAsLine
        className="w-[560px]"
        decisionStyle="certainty"
        agreeFrom={range.agreeFrom}
        disagreeTo={range.disagreeTo}
        onRangeChange={setRange}
      />
    );
  },
};

export const CountsAsWithAnswers: Story = {
  render: () => (
    <CountsAsLine
      className="w-[560px]"
      decisionStyle="certainty"
      split={{ agree: 38, unsure: 6, disagree: 11 }}
    />
  ),
};

export const CountsAsFixed: Story = {
  render: () => (
    <div className="grid w-[560px] gap-5">
      <CountsAsLine decisionStyle="agree" />
      <CountsAsLine decisionStyle="yesno" />
      <CountsAsLine decisionStyle="blind" />
    </div>
  ),
};

export const LockedControl: Story = {
  render: () => (
    <div className="grid w-80 gap-5">
      <ControlRow label="Draw as">
        {(labelId) => (
          <SegmentedControl
            aria-labelledby={labelId}
            fill
            defaultValue="outline"
            options={drawOptions}
          />
        )}
      </ControlRow>
      <ControlRow
        label="Confidence"
        locked={{ value: "Hidden", reason: "Locked by RT-14: confidence hidden this round" }}
      />
      <LockedReason>Everyone sees the objects in the same order, so agreement is fair</LockedReason>
    </div>
  ),
};

export const FieldStates: Story = {
  render: () => (
    <div className="grid w-96 gap-5">
      <FormField label="Task name" help="Reviewers see it in My work.">
        <TextFieldInput placeholder="Sentinel node AI evaluation" />
      </FormField>
      <FormField label="Task name" required>
        <TextFieldInput defaultValue="Sentinel node AI evaluation" />
      </FormField>
      <FormField
        label="Due date"
        required
        error="The due date is in the past. Pick a date from tomorrow."
      >
        <TextFieldInput defaultValue="12 Oct 2026" />
      </FormField>
      <FormField label="Reason" optional count="0 of 300">
        <textarea
          rows={3}
          aria-label="Reason"
          className="w-full resize-y rounded-ctl border border-line-strong bg-surf-field px-2.5 py-2 text-body-sm text-fg outline-none placeholder:text-fg-faint focus:border-accent"
        />
      </FormField>
      <FormField label="Project" disabled>
        <TextFieldInput defaultValue="P07 · Sentinel nodes" />
      </FormField>
    </div>
  ),
};

const tokenItems = [
  { id: "LM", name: people.LM.name, sub: people.LM.role, person: people.LM, end: "2 open tasks" },
  { id: "SM", name: people.SM.name, sub: people.SM.role, person: people.SM, end: "No open tasks" },
  { id: "AK", name: people.AK.name, sub: people.AK.role, person: people.AK, end: "1 open task" },
  {
    id: "PK",
    name: people.PK.name,
    sub: people.PK.role,
    person: people.PK,
    dim: "Away until 22 Oct",
  },
];

export const TokenFieldPicked: Story = {
  render: () => {
    const [picked, setPicked] = useState(["LM", "SM"]);
    return (
      <TokenField
        className="w-[480px]"
        label="Reviewers"
        items={tokenItems}
        picked={picked}
        onPickedChange={setPicked}
      />
    );
  },
};

export const TokenFieldLive: Story = {
  render: () => {
    const [picked, setPicked] = useState<string[]>([]);
    const [items, setItems] = useState<TokenItem[]>(tokenItems);
    const [invited, setInvited] = useState<string | null>(null);
    return (
      <div className="h-80 w-[480px]">
        <TokenField
          label="Reviewers"
          items={items}
          picked={picked}
          onPickedChange={setPicked}
          onInvite={(email) => {
            setItems([...items, { id: email, name: email, icon: "mail", sub: "Invited" }]);
            setPicked([...picked, email]);
            setInvited(email);
          }}
        />
        <button type="button" className="mt-3 text-body-sm text-fg-dim">
          Send the task
        </button>
        <p aria-live="polite" className="text-caption text-fg-dim">
          {invited ? `Invited ${invited}` : "Nobody invited"}
        </p>
      </div>
    );
  },
};

export const TokenFieldTyping: Story = {
  render: () => (
    <div className="h-72 w-[480px]">
      <TokenField
        label="Reviewers"
        items={tokenItems}
        picked={["LM"]}
        defaultOpen
        defaultQuery="a"
      />
    </div>
  ),
};

export const TokenFieldInvite: Story = {
  render: () => (
    <div className="h-40 w-[480px]">
      <TokenField
        label="Reviewers"
        items={tokenItems}
        picked={[]}
        defaultOpen
        defaultQuery="eva.novak@fnvltava.cz"
      />
    </div>
  ),
};

export const TokenFieldSlides: Story = {
  render: () => (
    <TokenField
      className="w-[480px]"
      label="Slides"
      placeholder="Type a slide or a case"
      items={[
        { id: "A1", name: "S26-04812 · A1 · H&E", thumbnail: mockAssets.overview },
        { id: "A2", name: "S26-04812 · A2 · H&E", thumbnail: mockAssets.mid },
      ]}
      picked={["A1", "A2"]}
    />
  ),
};

export const TokenFieldAway: Story = {
  render: () => (
    <div className="h-72 w-[480px]">
      <TokenField
        label="Reviewers"
        items={tokenItems.map((item) =>
          item.id === "PK"
            ? {
                id: item.id,
                name: item.name,
                person: people.PK,
                end: "Away until 22 Oct",
                endTone: "warn" as const,
              }
            : item,
        )}
        picked={["LM", "SM"]}
        defaultOpen
        defaultQuery="k"
      />
    </div>
  ),
};

export const LockableRows: Story = {
  render: () => {
    const [locked, setLocked] = useState(true);
    const [reason, setReason] = useState("Confidence hidden this round");
    return (
      <div className="grid w-[640px] gap-3">
        <LockableRow label="Draw as">
          <SegmentedControl aria-label="Draw as" defaultValue="outline" options={drawOptions} />
        </LockableRow>
        <LockableRow
          label="Confidence"
          lockable
          locked={locked}
          onLockedChange={setLocked}
          reason={reason}
          onReasonChange={setReason}
        >
          <SegmentedControl
            aria-label="Confidence"
            defaultValue="number"
            options={[
              { value: "number", label: "Number" },
              { value: "word", label: "Word" },
              { value: "hidden", label: "Hidden" },
            ]}
          />
        </LockableRow>
        <LockableRow
          label="Order"
          lockable
          locked
          reason="Or"
          reasonError="Use at least 5 characters."
        >
          <SegmentedControl
            aria-label="Order"
            defaultValue="ai"
            options={[
              { value: "ai", label: "AI order" },
              { value: "random", label: "Random" },
            ]}
          />
        </LockableRow>
      </div>
    );
  },
};
