import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../src/components/button.tsx";
import {
  EvidenceList,
  EvidenceRow,
  ProgressDots,
  QueueRow,
  QueueTable,
  QuotedNote,
  ReadinessList,
  ReadinessRow,
} from "../src/components/disagreements.tsx";
import { Person } from "../src/components/person.tsx";
import { StatusTag } from "../src/components/tag.tsx";
import { people } from "./fixtures.ts";

const meta = {
  title: "Components/Disagreements and sign-off",
  decorators: [
    (Story) => (
      <div className="w-140 rounded-zone bg-surf-panel p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const rows = [
  { object: "T2", slide: "A1", tag: "reviewers differ" },
  { object: "T4", slide: "A1", tag: "second look asked" },
  { object: "T5", slide: "A1", tag: "with Anna Kopecká", tone: "accent" as const, done: true },
  { object: "T1·C145", slide: "A1", tag: "both vs AI" },
  { object: "T1", slide: "tumor_031", tag: "declined by Anna Kopecká", tone: "warn" as const },
];

export const Queue: Story = {
  render: function QueueStory() {
    const [selected, setSelected] = useState("T2");
    const [checked, setChecked] = useState<string[]>(["T4"]);
    return (
      <QueueTable aria-label="Queue">
        {rows.map((row) => (
          <QueueRow
            key={row.object}
            object={row.object}
            slide={row.slide}
            tag={row.tag}
            tone={row.tone}
            done={row.done}
            checkable={!row.done}
            selected={selected === row.object}
            checked={checked.includes(row.object)}
            onSelect={() => setSelected(row.object)}
            onCheckedChange={(on) =>
              setChecked((now) =>
                on ? [...now, row.object] : now.filter((item) => item !== row.object),
              )
            }
          />
        ))}
      </QueueTable>
    );
  },
};

export const LockedQueue: Story = {
  render: () => (
    <QueueTable aria-label="Locked queue">
      {rows.slice(0, 3).map((row) => (
        <QueueRow key={row.object} object={row.object} slide={row.slide} tag={row.tag} locked />
      ))}
    </QueueTable>
  ),
};

export const Evidence: Story = {
  render: () => (
    <EvidenceList>
      <EvidenceRow icon="smart" title="AI · CAMELYON v1.0">
        Tumor, 91% sure
      </EvidenceRow>
      <EvidenceRow title={<Person person={people.LM} size={20} />}>
        <StatusTag tone="bad">Disagree · boundary is off</StatusTag>
        <QuotedNote>Runs past the capsule fold, about 0.4 mm.</QuotedNote>
      </EvidenceRow>
      <EvidenceRow icon="user" title="Reviewer B">
        <StatusTag tone="warn">Not sure · second look</StatusTag>
      </EvidenceRow>
      <EvidenceRow icon="check" title="Decision">
        <span className="text-fg-dim">Not decided yet</span>
      </EvidenceRow>
    </EvidenceList>
  ),
};

export const Readiness: Story = {
  render: () => (
    <ReadinessList>
      <ReadinessRow
        tone="warn"
        title="13 reviews not submitted"
        sub="Lenka Malá has 5 slides left and Simona Marková has 8 slides left"
        action={
          <Button size="sm" variant="ghost">
            Go to
          </Button>
        }
      />
      <ReadinessRow tone="ok" title="7 disagreements resolved" sub="2 by you, 3 by Anna Kopecká" />
    </ReadinessList>
  ),
};

export const Dots: Story = {
  render: function DotsStory() {
    const [current, setCurrent] = useState(1);
    return (
      <ProgressDots
        current={current}
        onJump={setCurrent}
        summary="1 of 3 decided"
        items={[
          { key: "T4", label: "T4", value: "disagree" },
          { key: "T5", label: "T5", value: null },
          { key: "C145", label: "T1·C145", value: null },
        ]}
      />
    );
  },
};
