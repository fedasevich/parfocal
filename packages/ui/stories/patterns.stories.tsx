import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppShell, Sidebar, TopBar } from "../src/components/app-shell.tsx";
import { CoSignColumns, DepositTable, ReportDocument } from "../src/components/clinical-report.tsx";
import { DecisionButtons } from "../src/components/decision-buttons.tsx";
import { DisplayPanel } from "../src/components/display-panel.tsx";
import { FlowMap } from "../src/components/flow-map.tsx";
import { FactList } from "../src/components/inspector.tsx";
import { IssueIndex } from "../src/components/issue-index.tsx";
import { MagnificationBar } from "../src/components/magnification-bar.tsx";
import {
  BlockCatalogue,
  BlockSettings,
  PdfPreview,
  ReportPagePreview,
} from "../src/components/report-templates.tsx";
import { ReviewTopBar } from "../src/components/review-top-bar.tsx";
import { SidePanel } from "../src/components/side-panel.tsx";
import { type OpinionQuestion, SlideDoneCard } from "../src/components/slide-done-card.tsx";
import { ObjectIdTag } from "../src/components/tag.tsx";
import { ConfirmInButton, ReviewerRow, TaskBlock } from "../src/components/team.tsx";
import { Hint, Zone } from "../src/components/zone.tsx";
import { flowEdges, flowNodes, issueGroups, mockAssets, people, reportBlocks } from "./fixtures.ts";

const meta = {
  title: "Patterns/App patterns",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const sidebarSections = [
  {
    items: [
      { id: "home", label: "Home", icon: "home" as const },
      { id: "worklist", label: "My work", icon: "slides" as const, count: 3 },
    ],
  },
  {
    title: "Projects",
    items: [
      { id: "p07", label: "P07 · Sentinel nodes", color: "#2563eb", count: 61 },
      { id: "p03", label: "P03 · Clinical nodes", color: "#0f766e", count: 24 },
      { id: "new", label: "New project", icon: "folder" as const },
    ],
  },
  {
    title: "Workspace",
    items: [
      { id: "team", label: "Team", icon: "users" as const },
      { id: "admin", label: "Admin", icon: "sliders" as const, tag: "admin" },
    ],
  },
];

export const Shell: Story = {
  render: () => (
    <div className="h-[560px]">
      <AppShell
        top={<TopBar user={people.LM} unread={6} jobs={1} />}
        side={<Sidebar sections={sidebarSections} active="worklist" />}
      >
        <div className="p-8">
          <h1 className="m-0 text-page-title font-semibold">My work</h1>
          <Hint>3 tasks to review.</Hint>
        </div>
      </AppShell>
    </div>
  ),
};

export const ShellWithWorkspace: Story = {
  render: () => (
    <div className="h-[560px]">
      <AppShell
        top={
          <TopBar
            user={people.LM}
            homeHref="#home"
            workspace={{
              name: "Fakultní nemocnice Vltava",
              subtitle: "Pathology and AI research",
              logo: "FV",
              color: "#0f766e",
            }}
            jobsSlot={null}
            bellSlot={
              <button type="button" className="text-fg-dim text-caption">
                Bell slot
              </button>
            }
          />
        }
        side={
          <Sidebar
            sections={sidebarSections.map((section) => ({
              ...section,
              items: section.items.map((item) => ({ ...item, href: `#/${item.id}` })),
            }))}
            active="home"
            renderLink={({ children, ...props }) => (
              <a {...props} data-router-link="">
                {children}
              </a>
            )}
          />
        }
      >
        <div className="p-8">
          <h1 className="m-0 text-page-title font-semibold">Home</h1>
        </div>
      </AppShell>
    </div>
  ),
};

const progress = { agree: 20, disagree: 6, unsure: 4, open: 25 };

export const ReviewTopBarGuided: Story = {
  render: () => (
    <ReviewTopBar
      mode="guided"
      backHref="#my-work"
      taskName="Sentinel node AI evaluation"
      taskSub="Sentinel node AI evaluation · due 24 Oct"
      slideName="A1 · H&E"
      slideThumb={mockAssets.overview}
      progress={progress}
      progressTitle="Slide 8 of 12"
      progressSub="about 1 h 20 min left"
      primaryDisabledReason="25 objects are still open."
    />
  ),
};

export const ReviewTopBarFull: Story = {
  render: () => (
    <ReviewTopBar
      mode="full"
      backHref="#my-work"
      taskName="Sentinel node AI evaluation"
      taskSub="Sentinel node AI evaluation · due 24 Oct"
      slideName="A1 · H&E"
      slideThumb={mockAssets.overview}
      progress={progress}
      progressTitle="Slide 8 of 12"
      progressSub="about 1 h 20 min left"
    />
  ),
};

export const ReviewTopBarAdjudicate: Story = {
  render: () => (
    <ReviewTopBar
      mode="adjudicate"
      backHref="#my-work"
      taskName="Adjudication · RT-14"
      taskSub="Sentinel node AI evaluation · due 24 Oct"
      slideName="A1 · H&E"
      slideThumb={mockAssets.overview}
      progress={{ agree: 2, disagree: 0, unsure: 0, open: 1 }}
      progressTitle="2 of 3 decided"
      progressSub="Objects queued for you"
    />
  ),
};

const counts = { total: 55, agree: 38, disagree: 11, unsure: 6, open: 0, added: 1 };

const questions: OpinionQuestion[] = [
  {
    id: "q1",
    question: "How useful was the AI on this slide?",
    kind: "scale",
    required: true,
    help: "1 not at all, 5 very",
    answer: "4",
  },
  {
    id: "q2",
    question: "What made it hard?",
    kind: "choice",
    options: ["Folds", "Faint staining", "Small deposits", "Nothing"],
  },
  { id: "q3", question: "Anything else?", kind: "text" },
];

export const ObjectsSidePanel: Story = {
  render: () => (
    <div className="flex h-[640px] justify-end bg-canvas">
      <SidePanel
        tabs={[
          {
            value: "objects",
            label: "Objects",
            count: 55,
            body: (
              <>
                <Zone title="AI says">
                  <FactList
                    tight
                    rows={[
                      {
                        icon: "layers",
                        label: "Result set",
                        value: "CAMELYON v1.0, imported 12 Oct",
                      },
                      { icon: "flag", label: "Tumor regions", value: "5, 6.2 to 0.4 mm" },
                      { icon: "target", label: "Cells", value: "18,240, 50 in your sample" },
                    ]}
                  />
                </Zone>
                <div className="flex items-center gap-2">
                  <ObjectIdTag>T2</ObjectIdTag>
                  <span className="text-body-sm text-fg-dim">Tumor region · 3.1 mm</span>
                </div>
              </>
            ),
            foot: (
              <>
                <b className="text-body-sm">Is T2 tumor?</b>
                <DecisionButtons decisionStyle="agree" size="compact" label="Your answer on T2" />
              </>
            ),
          },
          { value: "display", label: "Display", body: <DisplayPanel viewer /> },
          {
            value: "comments",
            label: "Comments",
            count: 4,
            body: <Hint>4 threads on this slide.</Hint>,
          },
          {
            value: "opinion",
            label: "Opinion",
            body: (
              <SlideDoneCard
                panel
                slideNumber={8}
                counts={counts}
                questions={questions}
                submitLabel="Submit and open slide 9"
              />
            ),
          },
        ]}
      />
    </div>
  ),
};

export const GuidedQuietTabs: Story = {
  render: () => (
    <div className="flex h-[640px] justify-end bg-canvas">
      <SidePanel
        variant="quiet"
        width={470}
        tabs={[
          { value: "review", label: "Review", body: <Hint>The question card goes here.</Hint> },
          { value: "comments", label: "Comments", body: <Hint>4 threads.</Hint> },
          { value: "display", label: "Display", body: <DisplayPanel /> },
        ]}
      />
    </div>
  ),
};

export const MagnificationBars: Story = {
  render: () => (
    <div className="grid justify-items-center gap-4 bg-canvas p-8">
      <MagnificationBar magnification={10} scaleLabel="500 µm" scalePx={80} micronsPerPixel={1} />
      <MagnificationBar
        magnification={10}
        scaleLabel="500 µm"
        scalePx={80}
        micronsPerPixel={1}
        open
      />
    </div>
  ),
};

export const SlideDone: Story = {
  render: () => (
    <div className="w-[470px] bg-chrome p-6">
      <SlideDoneCard
        slideNumber={8}
        counts={counts}
        questions={questions}
        submitLabel="Submit and open slide 9"
      />
    </div>
  ),
};

export const SlideDoneBlockers: Story = {
  render: () => (
    <div className="w-[470px] bg-chrome p-6">
      <SlideDoneCard
        slideNumber={8}
        counts={{ ...counts, agree: 34, open: 4 }}
        questions={[
          {
            id: "q1",
            question: "How useful was the AI on this slide?",
            kind: "scale",
            required: true,
            missing: true,
          },
          ...questions.slice(1),
        ]}
        submitLabel="Submit and open slide 9"
        blockers={[
          { id: "T5", text: "T5 is still open", goTo: "Go to T5" },
          { id: "cells", text: "3 cells in the sample are still open", goTo: "Go to the cells" },
          { id: "q1", text: "Question 1 is not answered", goTo: "Go to the question" },
        ]}
      />
    </div>
  ),
};

export const SlideDoneOneBlocker: Story = {
  render: () => (
    <div className="w-[470px] bg-chrome p-6">
      <SlideDoneCard
        slideNumber={8}
        counts={{ ...counts, agree: 37, open: 1 }}
        questions={questions}
        submitLabel="Submit and open slide 9"
        blockers={[{ id: "T5", text: "T5 is still open", goTo: "Go to T5" }]}
      />
    </div>
  ),
};

export const SlideDoneFailed: Story = {
  render: () => (
    <div className="w-[470px] bg-chrome p-6">
      <SlideDoneCard
        slideNumber={12}
        counts={counts}
        questions={questions}
        submitLabel="Submit and finish the task"
        failed
      />
    </div>
  ),
};

export const DisplayPanelDefault: Story = {
  render: () => (
    <div className="w-[340px] bg-chrome p-5">
      <DisplayPanel />
    </div>
  ),
};

export const DisplayPanelFoldedAndLocked: Story = {
  render: () => (
    <div className="w-[340px] bg-chrome p-5">
      <DisplayPanel
        folded={["draw", "move"]}
        locks={{
          confidence: { value: "Hidden", reason: "Locked by RT-14: confidence hidden this round" },
        }}
        preset={{
          current: "Tumor first",
          presets: [{ name: "Tumor first", key: "⇧2" }],
          changed: true,
          lockedCount: 1,
        }}
      />
    </div>
  ),
};

export const FlowMapLanes: Story = {
  render: () => (
    <FlowMap className="m-4" nodes={flowNodes} edges={flowEdges} width={1600} height={520} />
  ),
};

export const TeamTask: Story = {
  render: () => (
    <div className="grid gap-4 p-6">
      <div className="flex justify-end">
        <ConfirmInButton label="Nudge all behind" question="Nudge 2 people?" confirm="Yes, nudge" />
      </div>
      <TaskBlock
        title="RT-14 · Sentinel node AI evaluation"
        project="P07 · Sentinel nodes"
        due="24 Oct"
        dueIn="in 3 days"
      >
        <ReviewerRow
          person={people.LM}
          done={7}
          of={12}
          last="Last active 2 h ago"
          status="on-track"
        />
        <ReviewerRow
          person={people.JR}
          done={2}
          of={12}
          last="Last active 3 days ago"
          status="behind"
          nudged
        />
        <ReviewerRow
          person={people.PK}
          done={0}
          of={12}
          last="Not opened yet"
          status="away"
          awayUntil="22 Oct"
        />
        <ReviewerRow person={people.SM} done={12} of={12} last="Submitted 20 Oct" status="done" />
        <ReviewerRow
          person={people.DH}
          done={3}
          of={12}
          last="Last active today"
          status="on-track"
          you
        />
      </TaskBlock>
      <TaskBlock
        title="RT-11 · Cell typing check"
        project="P07 · Sentinel nodes"
        due="18 Oct"
        dueIn="3 days overdue"
        overdue
      >
        <ReviewerRow
          person={people.TB}
          done={0}
          of={6}
          last="Not opened yet"
          status="not-started"
        />
      </TaskBlock>
    </div>
  ),
};

export const Deposits: Story = {
  render: () => (
    <div className="w-[760px] p-6">
      <DepositTable
        deposits={[
          { id: "1", slide: "A1", objectId: "T1", sizeMm: 6.2, note: "Largest, past the capsule" },
          { id: "2", slide: "A1", objectId: "T2", sizeMm: 1.6 },
          { id: "3", slide: "A2", hand: true },
          { id: "4", slide: "A2", objectId: "T1", sizeMm: 0.4, removed: true },
        ]}
      />
    </div>
  ),
};

export const DepositsEditable: Story = {
  render: () => (
    <div className="w-[760px] p-6">
      <DepositTable
        onSizeChange={() => {}}
        onNoteChange={() => {}}
        errors={{ D3: "Enter the size." }}
        deposits={[
          { id: "D1", slide: "A1 · H&E", node: 1, objectId: "T1", sizeMm: 8, size: "8.0" },
          { id: "D2", slide: "A1 · H&E", node: 1, objectId: "T2", removed: true, sizeMm: 6.4 },
          { id: "D3", slide: "A2 · H&E", node: 2, hand: true, size: "", note: "Deeper level" },
        ]}
      />
    </div>
  ),
};

export const ClinicalReportDocument: Story = {
  render: () => (
    <div className="p-6">
      <ReportDocument
        model={{
          status: "final",
          lab: {
            name: "Fakultní nemocnice Vltava",
            department: "Department of Pathology",
            address: "Vltavská 1, 150 00 Praha 5",
            footer: "Laboratory 0001 · sample data · not a real patient",
          },
          head: [
            ["Accession", "S26-04812"],
            ["Received", "14 Oct 2026 14:20"],
          ],
          sections: [
            { title: "Specimen", body: "Sentinel lymph nodes #1 and #2, left axilla, excision" },
            {
              title: "Final diagnosis",
              body: "METASTATIC CARCINOMA, macrometastasis",
              diagnosis: true,
            },
          ],
          synopticTitle: "Synoptic report",
          standards: [["TNM", "UICC and AJCC 8th edition"]],
          rows: [["Size of largest metastatic deposit", "8.0 mm"]],
          after: [],
          sign: { by: "Electronically signed by MUDr. Lenka Malá", at: "15 October 2026 at 11:42" },
        }}
      />
    </div>
  ),
};

export const CoSign: Story = {
  render: () => (
    <div className="w-[760px] p-6">
      <CoSignColumns
        authorName="Lenka Malá"
        coSignerName="Anna Kopecká"
        rows={[
          { label: "Nodes examined", author: "3", coSigner: "3", ai: "3" },
          { label: "Nodes with metastasis", author: "1", coSigner: "1", ai: "1" },
          { label: "Largest deposit", author: "6.2 mm", coSigner: "6.4 mm", ai: "6.2 mm" },
          { label: "pN category", author: "pN1a", coSigner: "pN1a" },
        ]}
      />
    </div>
  ),
};

export const Templates: Story = {
  render: () => (
    <div className="grid grid-cols-[260px_minmax(0,1fr)_280px] gap-6 p-6">
      <BlockCatalogue blocks={reportBlocks} />
      <ReportPagePreview
        title="Sentinel node AI evaluation"
        blocks={reportBlocks.slice(0, 3)}
        selected="regions"
        pages={3}
      />
      <BlockSettings block={reportBlocks[1] ?? { id: "x", name: "Block", shows: "" }} />
    </div>
  ),
};

export const Pdf: Story = {
  render: () => (
    <PdfPreview className="m-6 h-[560px]" title="RT-14 evaluation report" pages={4} current={2} />
  ),
};

export const PdfFailed: Story = {
  render: () => (
    <PdfPreview className="m-6 h-[420px]" title="RT-14 evaluation report" pages={4} failed />
  ),
};

export const IssueStates: Story = {
  render: () => (
    <div className="w-[720px] p-6">
      <IssueIndex groups={issueGroups.slice(0, 4)} />
    </div>
  ),
};
