import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  AiResultToggle,
  annotatePresets,
  BlindFirstSwitch,
  ChangedDot,
  ChangesByMarker,
  CheckedCard,
  CheckOptions,
  type CheckOptionValues,
  CheckProgress,
  CheckStateTag,
  OriginCard,
  OriginMark,
  type PresetKey,
  PresetPicker,
  RunProgress,
  RunTiles,
  SignOffCard,
} from "../src/components/annotate-task.tsx";
import { people } from "./fixtures.ts";

const meta = {
  title: "Components/Annotate task",
  decorators: [
    (Story) => (
      <div className="w-[640px] rounded-zone bg-chrome p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function AiToggleDemo() {
  const [on, setOn] = useState(true);
  return (
    <AiResultToggle checked={on} onCheckedChange={setOn} resultName="CAMELYON v1.0" count={46} />
  );
}

function PresetsDemo() {
  const [value, setValue] = useState<PresetKey>("run");
  return <PresetPicker value={value} onValueChange={setValue} />;
}

function CheckOptionsDemo() {
  const preset = annotatePresets.find((item) => item.key === "run") ?? annotatePresets[0];
  const [values, setValues] = useState<CheckOptionValues | undefined>(preset?.options);
  if (values === undefined) return null;
  return <CheckOptions values={values} onValuesChange={setValues} />;
}

function BlindDemo() {
  const [on, setOn] = useState(false);
  return <BlindFirstSwitch checked={on} onCheckedChange={setOn} />;
}

export const OriginMarks: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <OriginMark origin="ai" />
      <OriginMark origin="ai-edited" author={people.AK} />
      <OriginMark origin="ai-confirmed" author={people.LM} />
      <OriginMark origin="human" author={people.SM} />
    </div>
  ),
};

export const OriginWithHistory: Story = {
  render: () => (
    <div className="grid gap-4">
      <OriginCard
        objectId="T5"
        classLabel="Tumor"
        classColour="var(--c-tumor)"
        origin="ai-edited"
        author={people.AK}
        history={[
          { id: "1", who: null, what: "Made by CAMELYON v1.0", when: "10:02" },
          { id: "2", who: people.AK, what: "Moved two points", when: "10:41" },
          { id: "3", who: people.LM, what: "Opened a thread", when: "11:05" },
        ]}
      />
      <OriginCard
        objectId="T9"
        classLabel="Immune"
        classColour="var(--c-immune)"
        origin="ai"
        history={[{ id: "1", who: null, what: "Made by CAMELYON v1.0", when: "10:02" }]}
      />
    </div>
  ),
};

export const AiToggle: Story = { render: () => <AiToggleDemo /> };

export const CheckProgressLine: Story = {
  render: () => (
    <div className="grid gap-5">
      <CheckProgress
        scope="AI objects"
        counts={{ confirmed: 14, edited: 5, deleted: 2, total: 46 }}
      />
      <CheckProgress
        scope="AI objects"
        counts={{ confirmed: 40, edited: 4, deleted: 2, total: 46 }}
      />
    </div>
  ),
};

export const CheckStates: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <CheckStateTag state="unchecked" />
      <CheckStateTag state="confirmed" />
      <CheckStateTag state="edited" />
      <CheckStateTag state="deleted" />
    </div>
  ),
};

export const CheckedCards: Story = {
  render: () => (
    <div className="flex flex-wrap gap-5">
      <CheckedCard
        summary="46 AI objects checked: 40 confirmed, 4 edited, 2 deleted. You added 3 by hand."
        onUndo={() => undefined}
        onNext={() => undefined}
      />
      <CheckedCard
        nothingToMark
        summary="You marked this slide as having nothing to mark. Colleagues see it as checked."
        onUndo={() => undefined}
        onNext={() => undefined}
      />
    </div>
  ),
};

export const SignOffWithOpenThreads: Story = {
  render: () => (
    <SignOffCard
      slideName="A1 H&E"
      openThreads={2}
      experts={[
        { person: people.LM, checked: true, sub: "Checked 11:20" },
        { person: people.AK, checked: true, sub: "Nothing to mark" },
        { person: people.SM, checked: true, sub: "Checked 12:05" },
      ]}
      onSignOff={() => undefined}
      onShowThreads={() => undefined}
    />
  ),
};

export const SignOffWaiting: Story = {
  render: () => (
    <SignOffCard
      slideName="A1 H&E"
      openThreads={0}
      experts={[
        { person: people.LM, checked: true },
        { person: people.AK, checked: false },
      ]}
    />
  ),
};

export const SignedOff: Story = {
  render: () => (
    <SignOffCard
      slideName="A1 H&E"
      openThreads={0}
      signedOff
      experts={[
        { person: people.LM, checked: true },
        { person: people.AK, checked: true },
      ]}
    />
  ),
};

export const Presets: Story = { render: () => <PresetsDemo /> };

export const CheckOptionsFromPreset: Story = { render: () => <CheckOptionsDemo /> };

export const BlindFirst: Story = { render: () => <BlindDemo /> };

export const StreamedRun: Story = {
  render: () => (
    <div className="grid gap-4">
      <RunProgress
        state="running"
        tilesDone={9}
        tilesTotal={24}
        objects={18420}
        estimate="4 min"
        onCancel={() => undefined}
      />
      <RunProgress state="cancelled" tilesDone={9} tilesTotal={24} objects={18420} />
      <RunProgress state="done" tilesDone={24} tilesTotal={24} objects={51236} />
      <svg
        role="img"
        aria-label="Finished tiles on the slide"
        viewBox="0 0 600 400"
        className="w-full rounded-zone bg-[#262626]"
      >
        <RunTiles
          columns={6}
          rows={4}
          width={600}
          height={400}
          finished={new Set([0, 1, 2, 6, 7, 8, 12])}
          runningTile={13}
        />
      </svg>
    </div>
  ),
};

export const LiveChanges: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <ChangesByMarker people={[people.AK, people.SM]} count={3} />
      <ChangesByMarker people={[people.AK]} count={1} />
      <span className="inline-flex items-center gap-2 text-body-sm text-fg">
        <ChangedDot /> Changed by a colleague
      </span>
    </div>
  ),
};
