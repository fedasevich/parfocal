import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../src/components/button.tsx";
import { CommentsTab, type CommentThreadCard } from "../src/components/comments-tab.tsx";
import { RegionRow } from "../src/components/inspector.tsx";
import { InspectorPanel } from "../src/components/inspector-panel.tsx";
import { type OpinionQuestion, SlideDoneCard } from "../src/components/slide-done-card.tsx";
import { type ResultSetRowItem, ResultSetRows } from "../src/components/visualize.tsx";
import type { AiArea } from "../src/lib/ai-state.ts";
import type { ViewerPartName } from "../src/lib/analysis-parts.ts";
import { type InspectorTemplate, inspectorCounts } from "../src/lib/inspector-tabs.ts";

const meta = {
  title: "Components/Inspector panel",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

type Call = "agree" | "disagree" | "unsure" | null;

const base: ViewerPartName[] = ["objects", "layers", "decisions", "opinion"];

const partsOf: Record<InspectorTemplate, ViewerPartName[]> = {
  none: base,
  "sentinel-node": [...base, "staging-hero", "area-list", "measure-step"],
  "cell-review": [...base, "unsure-zones", "cell-typing"],
};

const seedObjects: { object: string; size: number; probability: number; call: Call }[] = [
  { object: "T1", size: 7.7, probability: 0.68, call: "agree" },
  { object: "T2", size: 1.3, probability: 0.91, call: "disagree" },
  { object: "T3", size: 0.15, probability: 0.74, call: null },
  { object: "T4", size: 0.4, probability: 0.58, call: null },
];

const seedSets: ResultSetRowItem[] = [
  {
    key: "camelyon",
    name: "CAMELYON v1.0",
    sub: "Imported 12 Oct, the result this task checks",
    color: "#e0457b",
    fixed: true,
  },
  { key: "tumorscan", name: "TumorScan v2", sub: "Run here 13 Oct", color: "#3b82f6", on: false },
  { key: "reviewed", name: "Your review", sub: "The reviewed layer", color: "#10b981", on: true },
];

const seedThreads: CommentThreadCard[] = [
  {
    id: "th1",
    anchor: "T2",
    kind: "Tumor region",
    title: "Looks like a lymphoid aggregate",
    messages: 3,
    at: "13 Oct, 09:14",
    resolved: false,
  },
  {
    id: "th2",
    anchor: "T1",
    kind: "Tumor region",
    title: "Edge is unclear here",
    messages: 1,
    at: "13 Oct, 10:02",
    resolved: false,
  },
  {
    id: "th3",
    anchor: "Pin",
    kind: "Pin",
    title: "Check the scanner artefact",
    messages: 2,
    at: "12 Oct, 16:40",
    resolved: true,
  },
];

const seedQuestions: OpinionQuestion[] = [
  {
    id: "q1",
    question: "How sure are you of the overall call?",
    required: true,
    kind: "scale",
  },
  { id: "q2", question: "Would you send this slide for a second read?", kind: "yesno" },
];

const callWord: Record<Exclude<Call, null>, string> = {
  agree: "Agree",
  disagree: "Disagree",
  unsure: "Not sure",
};

function Inspector({ template }: { template: InspectorTemplate }) {
  const [tab, setTab] = useState<string>("objects");
  const [objects, setObjects] = useState(seedObjects);
  const [sets, setSets] = useState(seedSets);
  const [threads, setThreads] = useState(seedThreads);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const counts = inspectorCounts({
    objects: objects.length,
    resultSets: sets.length,
    threads: threads.map((thread) => ({ resolved: thread.resolved })),
    questions: seedQuestions.map((question) => ({ answered: Boolean(answers[question.id]) })),
  });
  const staged: AiArea[] = objects.map((item) => ({
    object: item.object,
    size: item.size,
    probability: item.probability,
    ...(item.call ? { call: item.call } : {}),
  }));
  const open = objects.filter((item) => item.call === null).length;
  const split = (call: Call) => objects.filter((item) => item.call === call).length;
  return (
    <div className="flex h-[720px] bg-page text-fg">
      <div className="grid content-start gap-2 p-3" data-testid="controls">
        <Button onClick={() => setObjects(objects.slice(0, -1))}>Remove the last object</Button>
        <Button
          onClick={() =>
            setObjects(
              objects.map((item) =>
                item.object === "T3" ? { ...item, call: "unsure" as const } : item,
              ),
            )
          }
        >
          Decide T3 not sure
        </Button>
        <Button
          onClick={() =>
            setSets([
              ...sets,
              {
                key: `added-${sets.length}`,
                name: "Added set",
                sub: "Imported today",
                color: "#a855f7",
                on: false,
              },
            ])
          }
        >
          Add a result set
        </Button>
        <Button
          onClick={() =>
            setThreads(
              threads.map((thread) =>
                thread.id === "th1" ? { ...thread, resolved: true } : thread,
              ),
            )
          }
        >
          Resolve the first thread
        </Button>
      </div>
      <InspectorPanel
        template={template}
        parts={partsOf[template]}
        counts={counts}
        value={tab}
        onValueChange={setTab}
        staging={{ areas: staged }}
        bodies={{
          objects: {
            body: (
              <ul aria-label="Objects" className="m-0 grid list-none gap-1 p-0">
                {objects.map((item) => (
                  <li key={item.object} data-object={item.object}>
                    <RegionRow
                      objectId={item.object}
                      kind="Tumor region"
                      size={`${item.size} mm`}
                      note={item.call ? callWord[item.call] : "Still open"}
                    />
                  </li>
                ))}
              </ul>
            ),
          },
          display: {
            body: <ResultSetRows sets={sets} aria-label="Result sets" />,
          },
          comments: {
            body: <CommentsTab slideLabel="A1" threads={threads} />,
          },
          opinion: {
            body: (
              <SlideDoneCard
                panel
                slideNumber={8}
                counts={{
                  total: objects.length,
                  agree: split("agree"),
                  disagree: split("disagree"),
                  unsure: split("unsure"),
                  open,
                }}
                questions={seedQuestions.map((question) => ({
                  ...question,
                  ...(answers[question.id] ? { answer: answers[question.id] } : {}),
                }))}
                submitLabel="Submit"
                onAnswerChange={(id, value) => setAnswers({ ...answers, [id]: value })}
              />
            ),
          },
        }}
      />
    </div>
  );
}

export const SentinelNode: Story = {
  render: () => <Inspector template="sentinel-node" />,
};

export const CellReview: Story = {
  render: () => <Inspector template="cell-review" />,
};

export const NoTemplate: Story = {
  render: () => <Inspector template="none" />,
};
