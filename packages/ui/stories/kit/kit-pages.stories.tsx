import type { Meta, StoryObj } from "@storybook/react-vite";
import { Banner, InlineError } from "../../src/components/banner.tsx";
import { BeforeYouList } from "../../src/components/before-you-list.tsx";
import { Button } from "../../src/components/button.tsx";
import { CoSignColumns, DepositTable } from "../../src/components/clinical-report.tsx";
import { ControlRow } from "../../src/components/control-row.tsx";
import { CountsAsLine } from "../../src/components/counts-as.tsx";
import { DecisionButtons } from "../../src/components/decision-buttons.tsx";
import { DisplayPanel } from "../../src/components/display-panel.tsx";
import { FlowMap } from "../../src/components/flow-map.tsx";
import { FlowBar, FlowPage } from "../../src/components/flow-page.tsx";
import { FormField, TextFieldInput } from "../../src/components/form-field.tsx";
import { Icon, type IconName, type IconSize } from "../../src/components/icon.tsx";
import { IssueIndex } from "../../src/components/issue-index.tsx";
import { Keycap } from "../../src/components/keycap.tsx";
import { ProgressBar } from "../../src/components/progress-meter.tsx";
import {
  BlockCatalogue,
  BlockSettings,
  PdfPreview,
  ReportPagePreview,
} from "../../src/components/report-templates.tsx";
import { SegmentedControl } from "../../src/components/segmented-control.tsx";
import { SlideDoneCard } from "../../src/components/slide-done-card.tsx";
import { SmallModalZone } from "../../src/components/small-modal.tsx";
import {
  CategoryTag,
  CountBadge,
  FilterChip,
  ObjectIdTag,
  ResultSetTag,
  StatusTag,
} from "../../src/components/tag.tsx";
import { ConfirmInButton, ReviewerRow, TaskBlock } from "../../src/components/team.tsx";
import { Token } from "../../src/components/token-field.tsx";
import { ToolRailButton } from "../../src/components/tool-rail-button.tsx";
import { Hint, Zone } from "../../src/components/zone.tsx";
import {
  flowEdges,
  flowNodes,
  issueGroups,
  people,
  projectClasses,
  reportBlocks,
} from "../fixtures.ts";
import { BothThemes, Frame, Grid2, KitPage, RulesTable, Tight } from "./kit-layout.tsx";

const meta = {
  title: "Kit/Pages",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const HowAReviewWorks: Story = {
  name: "How a review works",
  render: () => (
    <KitPage
      title="How a review works"
      intro="The first screen of the mock is a map of the whole review in four lanes. Each box opens its screen in the scene the map names, and a box whose screen task has not landed yet shows dim."
    >
      <Frame label="Flow map / four lanes" flush>
        <FlowMap
          nodes={flowNodes.map((node) => ({ ...node, dim: node.kind !== "root" }))}
          edges={flowEdges}
          width={1600}
          height={520}
        />
      </Frame>
    </KitPage>
  ),
};

const styleRows: Array<[string, ...string[]]> = [
  [
    "5-point certainty, the default",
    '"AI says: Tumor, 91% sure", then "How sure are you that T2 is tumor?"',
    "1 Certainly not, 2 Probably not, 3 Can't tell, 4 Probably, 5 Certainly, keys 1 to 5",
    "Editable. By default 4 and 5 agree with the AI, 3 is not sure, 1 and 2 disagree",
  ],
  [
    "Agree with the AI",
    '"AI says: Tumor, 91% sure", then "Is T2 tumor?"',
    "Agree K, Disagree X, Not sure U",
    "Fixed. Each button counts as its name",
  ],
  [
    "Yes or no",
    'The template\'s question, by default "Is this tumor?", with the AI claim hidden',
    "Yes Y, No N, Not sure U",
    "Fixed. Yes agrees when the AI claim is positive for the object, otherwise it disagrees, and No is the reverse",
  ],
  [
    "Pick the class blind",
    '"What is T2?" with the AI claim hidden',
    "One button per project class with its key, plus Not sure U",
    "Fixed. The AI's class agrees, any other class disagrees",
  ],
];

export const DecisionStyles: Story = {
  name: "Decision styles",
  render: () => (
    <KitPage
      title="Decision styles and Counts as"
      intro="A task asks one question per object in one of four styles. The study template sets the style, and the New review task flow and the template editor can change it. Guided review, the Objects tab, the cells panel, the disagreement queue, the adjudicator view and the report all read the same style."
    >
      <Frame label="Four styles">
        <RulesTable
          head={["Style", "The question for region T2", "Buttons and keys", "Counts as"]}
          rows={styleRows}
        />
      </Frame>
      <Grid2>
        <Frame label="Guided size / 5-point certainty and agree">
          <div className="grid gap-5">
            <DecisionButtons decisionStyle="certainty" value="4" label="Certainty on T2" />
            <DecisionButtons decisionStyle="agree" label="Agree on T2" />
          </div>
        </Frame>
        <Frame label="Guided size / yes or no and the blind pick">
          <div className="grid gap-5">
            <DecisionButtons decisionStyle="yesno" label="Yes or no on T2" />
            <DecisionButtons
              decisionStyle="blind"
              classes={projectClasses}
              aiClass="Tumor"
              label="Class of T2"
            />
          </div>
        </Frame>
        <Frame label="Compact size / Objects tab, cells panel, queue">
          <div className="grid gap-3">
            <DecisionButtons decisionStyle="certainty" size="compact" label="Certainty, compact" />
            <DecisionButtons
              decisionStyle="agree"
              size="compact"
              value="agree"
              label="Agree, compact"
            />
            <DecisionButtons decisionStyle="yesno" size="compact" label="Yes or no, compact" />
            <DecisionButtons
              decisionStyle="blind"
              size="compact"
              classes={projectClasses}
              label="Blind, compact"
            />
          </div>
        </Frame>
        <Frame label="The Counts as line">
          <div className="grid gap-5">
            <CountsAsLine decisionStyle="certainty" />
            <CountsAsLine
              decisionStyle="certainty"
              split={{ agree: 38, unsure: 6, disagree: 11 }}
            />
            <CountsAsLine decisionStyle="blind" />
          </div>
        </Frame>
      </Grid2>
    </KitPage>
  ),
};

export const DisplayPanelPage: Story = {
  name: "Display panel",
  render: () => (
    <KitPage
      title="The Display panel, presets and locks"
      intro="How objects draw, what the AI shows and how the review moves, in one panel that is the same in guided review and the full viewer. A task sets the defaults and can lock what must stay the same for everyone."
    >
      <Grid2>
        <Frame label="Panel / open">
          <div className="max-w-[340px]">
            <DisplayPanel viewer />
          </div>
        </Frame>
        <Frame label="Panel / folded zones, a lock and a changed preset">
          <div className="max-w-[340px]">
            <DisplayPanel
              folded={["draw", "move"]}
              locks={{
                confidence: {
                  value: "Hidden",
                  reason: "Locked by RT-14: confidence hidden this round",
                },
              }}
              preset={{
                current: "Tumor first",
                presets: [{ name: "Tumor first", key: "⇧2" }],
                changed: true,
                lockedCount: 1,
              }}
            />
          </div>
        </Frame>
      </Grid2>
      <Frame label="Locks">
        <Tight
          items={[
            'A task locks a setting in its Display defaults step, and every lock needs a reason, such as "Everyone sees the objects in the same order, so agreement is fair"',
            'A locked control reads as dim text with a lock icon and the reason under it, such as "Locked by RT-14: confidence hidden this round". It does not respond',
            "A preset that would change a locked value keeps the lock, and the menu says how many settings the task locks",
          ]}
        />
      </Frame>
    </KitPage>
  ),
};

const doneCounts = { total: 55, agree: 38, disagree: 11, unsure: 6, open: 0, added: 1 };

export const SubmitAndSlideDone: Story = {
  name: "Submit and Slide done",
  render: () => (
    <KitPage
      title="Submit gating and the Slide done card"
      intro="A slide can be submitted only when nothing in its scope is left open. The Slide done card says what was checked, asks the opinion questions and holds the one Submit button."
    >
      <Grid2>
        <Frame label="Slide done / ready">
          <SlideDoneCard
            slideNumber={8}
            counts={doneCounts}
            submitLabel="Submit and open slide 9"
            questions={[
              {
                id: "q1",
                question: "How useful was the AI on this slide?",
                kind: "scale",
                required: true,
                answer: "4",
                help: "1 not at all, 5 very",
              },
              { id: "q2", question: "Anything else?", kind: "text" },
            ]}
          />
        </Frame>
        <Frame label="Slide done / Before you submit">
          <SlideDoneCard
            slideNumber={8}
            counts={{ ...doneCounts, agree: 34, open: 4 }}
            submitLabel="Submit and open slide 9"
            questions={[
              {
                id: "q1",
                question: "How useful was the AI on this slide?",
                kind: "scale",
                required: true,
                missing: true,
              },
            ]}
            blockers={[
              { id: "T5", text: "T5 is still open", goTo: "Go to T5" },
              {
                id: "cells",
                text: "3 cells in the sample are still open",
                goTo: "Go to the cells",
              },
              { id: "q1", text: "Question 1 is not answered", goTo: "Go to the question" },
            ]}
          />
        </Frame>
        <Frame label="When submitting fails">
          <div className="grid gap-4">
            <Banner inline actions={<Button size="sm">Retry now</Button>}>
              <b>Connection lost.</b> Decisions can't be saved right now. Nothing is lost. Retrying…
            </Banner>
            <InlineError>
              The review could not be submitted. Nothing was lost, every decision is saved.
            </InlineError>
          </div>
        </Frame>
        <Frame label="Gating">
          <Tight
            items={[
              "Submit works only when every object in scope is decided and every required question is answered. Not sure counts as decided",
              'With one blocker the primary is off and the reason sits under it, such as "T5 is still open."',
              "With two or more a Before you submit list replaces the hint, one row per blocker with a Go to link",
              "The button reads Submit and open slide 9 with Enter, and on the last slide Submit and finish the task",
            ]}
          />
        </Frame>
      </Grid2>
    </KitPage>
  ),
};

export const Team: Story = {
  render: () => (
    <KitPage
      title="Team, who is reviewing what"
      intro="A researcher's view of the work handed out: one block per open task, one row per reviewer, and the two actions that move a late task, Nudge and Reassign. Invites and roles stay in Admin."
    >
      <Frame label="Team / open tasks">
        <div className="grid gap-4">
          <div className="flex items-center justify-between">
            <Hint>2 open tasks, 1 reviewer behind, 1 away.</Hint>
            <ConfirmInButton
              label="Nudge all behind"
              question="Nudge 2 people?"
              confirm="Yes, nudge"
            />
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
            />
            <ReviewerRow
              person={people.PK}
              done={0}
              of={12}
              last="Not opened yet"
              status="away"
              awayUntil="22 Oct"
            />
            <ReviewerRow
              person={people.SM}
              done={12}
              of={12}
              last="Submitted 20 Oct"
              status="done"
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
      </Frame>
      <Grid2>
        <Frame label="Nudge / the window body">
          <SmallModalZone>
            <FormField label="Message" count="96 of 300">
              <TextFieldInput defaultValue="Hi Jan, RT-14 is due on 24 Oct and 10 slides are still to review." />
            </FormField>
          </SmallModalZone>
        </Frame>
        <Frame label="Reassign / the window body">
          <SmallModalZone title="Which slides">
            <SegmentedControl
              aria-label="Which slides"
              defaultValue="rest"
              options={[
                { value: "rest", label: "The 10 not started" },
                { value: "all", label: "All 12" },
              ]}
            />
            <Hint>Picking every slide keeps the decisions already made with their author.</Hint>
          </SmallModalZone>
        </Frame>
      </Grid2>
    </KitPage>
  ),
};

export const ClinicalReport: Story = {
  name: "Clinical report and sign-out",
  render: () => (
    <KitPage
      title="Clinical report, sign-out and co-sign"
      intro="Only a project in Clinical privacy mode has a clinical report. The report of a case is a flow page filled from the decisions, and a project right decides who signs it out and who sends it for co-sign."
    >
      <Frame label="Clinical report / Staging step" flush>
        <FlowPage
          className="h-[620px]"
          crumbs={[{ label: "P03 · Clinical nodes" }, { label: "S26-04812" }, { label: "Report" }]}
          title="Report for S26-04812"
          subtitle="Sentinel node report v2"
          steps={[
            { label: "Findings" },
            { label: "Staging" },
            { label: "Report text" },
            { label: "Sign out" },
          ]}
          current={1}
          bar={
            <FlowBar
              back={<Button>Back</Button>}
              hint="The largest deposit sets the suggested category."
              next={<Button variant="primary">Next</Button>}
            />
          }
        >
          <Zone title="Deposits" end={<Button size="sm">Add a deposit</Button>}>
            <DepositTable
              deposits={[
                { id: "1", slide: "A1", objectId: "T1", sizeMm: 6.2, note: "Past the capsule" },
                { id: "2", slide: "A1", objectId: "T2", sizeMm: 1.6 },
                { id: "3", slide: "A2", objectId: "T1", sizeMm: 0.4, removed: true },
              ]}
            />
          </Zone>
        </FlowPage>
      </Frame>
      <Grid2>
        <Frame label="Signing out / the window body">
          <div className="grid gap-3">
            <Button variant="primary" size="lg" block>
              <Icon name="shield" />
              Sign with the institution's SSO
            </Button>
            <InlineError
              actions={
                <button
                  type="button"
                  className="cursor-pointer border-0 bg-transparent p-0 font-medium text-accent"
                >
                  Use a password instead
                </button>
              }
            >
              Single sign-on did not answer. Nothing was signed.
            </InlineError>
          </div>
        </Frame>
        <Frame label="Co-sign review / side by side">
          <CoSignColumns
            authorName="Lenka Malá"
            coSignerName="Anna Kopecká"
            rows={[
              { label: "Nodes with metastasis", author: "1", coSigner: "1", ai: "1" },
              { label: "Largest deposit", author: "6.2 mm", coSigner: "6.4 mm", ai: "6.2 mm" },
              { label: "pN category", author: "pN1a", coSigner: "pN1a" },
            ]}
          />
        </Frame>
      </Grid2>
    </KitPage>
  ),
};

export const StudyTemplates: Story = {
  name: "Study templates",
  render: () => (
    <KitPage
      title="Study templates and the report"
      intro="The evaluation report is built from blocks, like lego. A study template names the blocks in order and fills in a new review task."
    >
      <Frame label="Template editor / catalogue, page and block settings">
        <div className="grid grid-cols-[240px_minmax(0,1fr)_260px] gap-6">
          <BlockCatalogue blocks={reportBlocks} />
          <ReportPagePreview
            title="Sentinel node AI evaluation"
            blocks={reportBlocks.slice(0, 3)}
            selected="regions"
            pages={3}
          />
          <BlockSettings block={reportBlocks[1] ?? { id: "x", name: "Block", shows: "" }} />
        </div>
      </Frame>
      <Frame label="Preview the PDF" flush>
        <PdfPreview
          className="h-[480px] rounded-none border-0"
          title="RT-14 evaluation report"
          pages={4}
          current={1}
        />
      </Frame>
    </KitPage>
  ),
};

export const SmallModalsAndFlowPages: Story = {
  name: "Small modals and flow pages",
  render: () => (
    <KitPage
      title="Small modals and flow pages"
      intro="Two shapes hold every form in the app. A small modal holds one to three zones. Anything longer is a flow page with a stepper."
    >
      <Grid2>
        <Frame label="Small modal / 480 px, one group of fields">
          <div className="mx-auto w-[480px] rounded-[14px] border border-line bg-surf-panel">
            <div className="grid gap-1 px-5 pt-5">
              <b className="text-title-sm font-semibold">Save a preset</b>
              <span className="text-body-sm text-fg-dim">
                Keep these Display settings under a name.
              </span>
            </div>
            <div className="grid gap-5 p-5">
              <FormField label="Name">
                <TextFieldInput defaultValue="Tumor first" />
              </FormField>
            </div>
            <div className="flex items-center gap-2 border-t border-line px-5 py-3.5">
              <span className="flex-1 text-body-sm text-fg-dim">Only you see it.</span>
              <Button>
                Cancel
                <Keycap keys="Esc" size="sm" />
              </Button>
              <Button variant="primary">
                Save
                <Keycap keys="↵" size="sm" />
              </Button>
            </div>
          </div>
        </Frame>
        <Frame label="Small modal / 560 px with a Before you can list">
          <div className="mx-auto w-[560px] rounded-[14px] border border-line bg-surf-panel">
            <div className="grid gap-1 px-5 pt-5">
              <b className="text-title-sm font-semibold">Sign off RT-14</b>
              <span className="text-body-sm text-fg-dim">
                Sentinel node AI evaluation · 12 slides
              </span>
            </div>
            <div className="grid gap-5 p-5">
              <Hint>The answers become read-only.</Hint>
            </div>
            <div className="border-t border-line px-5 pt-3.5">
              <BeforeYouList
                blockers={[
                  { id: "r", text: "2 reviews are still missing", goTo: "Go to Team" },
                  { id: "d", text: "3 disagreements are still open", goTo: "Go to the queue" },
                ]}
              />
            </div>
            <div className="flex items-center gap-2 px-5 py-3.5">
              <span className="flex-1" />
              <Button>Cancel</Button>
              <Button variant="primary" disabled>
                Sign with the institution's SSO
              </Button>
            </div>
          </div>
        </Frame>
      </Grid2>
      <Frame label="Flow page / breadcrumb, stepper and sticky bottom bar" flush>
        <FlowPage
          className="h-[480px]"
          crumbs={[{ label: "P07 · Sentinel nodes" }, { label: "New review task" }]}
          title="New review task"
          subtitle="Ask reviewers to check one result set on the slides you pick."
          steps={[
            { label: "Slides" },
            { label: "Reviewers" },
            { label: "What to check" },
            { label: "How it runs" },
            { label: "Send" },
          ]}
          current={1}
          moreBelow
          bar={
            <FlowBar
              back={<Button>Back</Button>}
              hint="Pick at least one reviewer."
              next={
                <Button variant="primary" disabled>
                  Next
                </Button>
              }
            />
          }
        >
          <Zone title="Reviewers" sub="Type a name or an email.">
            <div className="flex flex-wrap gap-1.5">
              <Token
                item={{ id: "LM", name: people.LM.name, person: people.LM }}
                onRemove={() => undefined}
              />
              <Token
                item={{ id: "SM", name: people.SM.name, person: people.SM }}
                onRemove={() => undefined}
              />
            </div>
          </Zone>
        </FlowPage>
      </Frame>
    </KitPage>
  ),
};

export const ErrorAndIssueStates: Story = {
  name: "Error and issue states",
  render: () => (
    <KitPage
      title="Error and issue states"
      intro={`Every error and empty state is a scene of its own screen, and the Issue states screen in the mock is an index of all of them. ${issueGroups.reduce((sum, group) => sum + group.states.length, 0)} states in ${issueGroups.length} flows.`}
    >
      <Grid2>
        <Frame label="The one banner">
          <div className="grid gap-3">
            <Banner inline>
              <b>Connection lost.</b> Nothing is lost and it retries by itself.
            </Banner>
            <Banner inline tone="info">
              A slow source, the hint names it.
            </Banner>
          </div>
        </Frame>
        <Frame label="The one inline error">
          <div className="grid gap-4">
            <FormField
              label="Due date"
              error="The due date is in the past. Pick a date from tomorrow."
            >
              <TextFieldInput defaultValue="12 Oct 2026" />
            </FormField>
            <InlineError>The PDF could not be made. The CSV files still download.</InlineError>
          </div>
        </Frame>
      </Grid2>
      <Frame label="States by flow">
        <IssueIndex groups={issueGroups} />
      </Frame>
    </KitPage>
  ),
};

const iconRows: Array<[IconSize, number, string, IconName[]]> = [
  [
    "xs",
    12,
    "Inside a tag, a checkbox, a token's remove cross, a chevron in a 20 px control",
    ["check", "layers", "close"],
  ],
  [
    "sm",
    16,
    "The default. Buttons, inputs, menus, table rows, the top bar, the tool rail",
    ["upload", "search", "bell", "more"],
  ],
  [
    "md",
    20,
    "Sidebar navigation, the large guided answer buttons, Home tiles, zone headers",
    ["home", "folder", "users", "sliders"],
  ],
  [
    "lg",
    24,
    "Drop zones, inline empty states, the bottom dock for pen and touch",
    ["upload", "info"],
  ],
  ["xl", 40, "The badge on a done, sent or empty screen", ["check"]],
];

const typeRows = [
  [
    "Label · 11/16",
    "text-label font-semibold uppercase tracking-[0.07em] text-fg-faint",
    "AREAS, LARGEST FIRST",
  ],
  ["Caption · 12/16", "text-caption", "Imported 12 Oct from tumor_009_camelyon.geojson"],
  ["Body small · 13/18", "text-body-sm", "Tumor region · 6.2 mm across"],
  ["Body · 14/20", "text-body", "Only the largest deposit sets the node's category."],
  ["Lead · 16/24", "text-lead", "Tumor, 91% sure · 6.2 mm across"],
  ["Title small · 18/24", "text-title-sm font-semibold", "Run a model"],
  ["Title · 20/28", "text-title font-semibold", "Metastasis likely"],
  ["Page title · 24/32", "text-page-title font-semibold", "Sentinel node AI evaluation"],
  ["Display · 28/36", "text-display font-semibold", "Is T2 tumor?"],
];

export const UiKitTagsIconsType: Story = {
  name: "UI kit: tags, icons and type",
  render: () => (
    <KitPage
      title="UI kit: tags, icons and type"
      intro="One look per job, measured from every Parfocal screen in the mock. Specimens render in both themes."
    >
      <Frame label="Tags / nine types cover the whole app">
        <RulesTable
          head={["Type", "Looks like", "Use for"]}
          rows={[
            [
              "Status",
              <BothThemes key="s">
                <div className="flex flex-wrap gap-2">
                  <StatusTag>Not started</StatusTag>
                  <StatusTag tone="accent">In review</StatusTag>
                  <StatusTag tone="ok">Ready to sign off</StatusTag>
                  <StatusTag tone="warn">7 disagreements</StatusTag>
                  <StatusTag tone="bad">Read error</StatusTag>
                  <StatusTag tone="research">Research output</StatusTag>
                </div>
              </BothThemes>,
              "The state of something that changes. Tones are neutral, accent, ok, warn, bad and research.",
            ],
            [
              "Category",
              <BothThemes key="c">
                <div className="flex flex-wrap gap-2">
                  <CategoryTag>Regions</CategoryTag>
                  <CategoryTag>admin</CategoryTag>
                  <CategoryTag tone="info" icon="link">
                    remote
                  </CategoryTag>
                </div>
              </BothThemes>,
              "A fixed fact about a thing. The square corners tell it apart from a status.",
            ],
            [
              "Object ID",
              <BothThemes key="o">
                <div className="flex flex-wrap items-center gap-2">
                  <ObjectIdTag>T2</ObjectIdTag>
                  <ObjectIdTag>T1·C145</ObjectIdTag>
                  <ObjectIdTag size="lg">T2</ObjectIdTag>
                </div>
              </BothThemes>,
              "Every citable object: T2, T1·C145, R4, Z1, M1.",
            ],
            [
              "Result set",
              <BothThemes key="r">
                <div className="flex flex-wrap gap-2">
                  <ResultSetTag source="imported">CAMELYON v1.0</ResultSetTag>
                  <ResultSetTag source="run">PathoSAM v1.2</ResultSetTag>
                  <ResultSetTag>Reviewed live</ResultSetTag>
                </div>
              </BothThemes>,
              "One AI result set on a slide. Accent when imported, green when run in Parfocal, gray for the reviewed layer.",
            ],
            [
              "Count",
              <BothThemes key="n">
                <div className="flex gap-2">
                  <CountBadge attention>6</CountBadge>
                  <CountBadge>61</CountBadge>
                </div>
              </BothThemes>,
              "Blue for things that need you. Gray for totals.",
            ],
            [
              "Keycap",
              <BothThemes key="k">
                <div className="flex items-center gap-2">
                  <Keycap keys="K" />
                  <Keycap keys="⌘K" />
                  <Keycap keys="↵" size="sm" />
                  <Keycap keys="X" size="lg" />
                </div>
              </BothThemes>,
              "The key for an action, shown next to it.",
            ],
            [
              "Token",
              <BothThemes key="t">
                <div className="flex flex-wrap gap-2">
                  <Token
                    item={{ id: "LM", name: people.LM.name, person: people.LM }}
                    onRemove={() => undefined}
                  />
                  <Token
                    item={{ id: "SM", name: people.SM.name, person: people.SM }}
                    onRemove={() => undefined}
                  />
                </div>
              </BothThemes>,
              "A picked person or slide inside a type-to-find field.",
            ],
            [
              "Filter chip",
              <BothThemes key="f">
                <div className="flex flex-wrap gap-2">
                  <FilterChip defaultPressed>Breast</FilterChip>
                  <FilterChip>GI</FilterChip>
                </div>
              </BothThemes>,
              "A choice you toggle. It is a control, not a tag.",
            ],
          ]}
        />
      </Frame>
      <Frame label="Icons / five sizes, one stroke">
        <BothThemes>
          <div className="flex flex-wrap items-end gap-5.5">
            {iconRows.map(([size, px, , icons]) => (
              <div key={size} className="grid justify-items-center gap-2 text-caption text-fg-dim">
                <span className="flex items-center gap-2 text-fg">
                  {icons.map((name) => (
                    <Icon key={name} name={name} size={size} />
                  ))}
                </span>
                <b>
                  {size} · {px} px
                </b>
              </div>
            ))}
          </div>
        </BothThemes>
      </Frame>
      <Frame label="Type / nine sizes, nothing between them">
        <BothThemes>
          <div className="grid">
            {typeRows.map(([name, className, example]) => (
              <div
                key={name}
                className="grid grid-cols-[150px_1fr] items-baseline gap-4 border-b border-line py-2"
              >
                <small className="font-mono text-caption text-fg-faint">{name}</small>
                <span className={className}>{example}</span>
              </div>
            ))}
          </div>
        </BothThemes>
      </Frame>
    </KitPage>
  ),
};

const swatches = [
  ["surf-page", "Page behind the panels"],
  ["surf-panel", "Panels, the side column"],
  ["surf-section", "A zone inside a panel"],
  ["surf-field", "Fields"],
  ["chrome-3", "Control fill, tags"],
  ["canvas", "Around the slide"],
  ["line", "Divider"],
  ["line-strong", "Control border"],
  ["fg", "Text"],
  ["fg-dim", "Secondary text, hints"],
  ["fg-faint", "Labels"],
  ["accent", "Accent, focus, selection"],
  ["accent-fill", "Primary fill"],
  ["ok", "Done, a check"],
  ["warn", "Open, a warning"],
  ["bad", "Error"],
  ["unsure", "Unsure cells and zones"],
  ["research-fg", "Research output"],
  ["decision-agree", "Agree with the AI"],
  ["decision-disagree", "Disagree"],
  ["decision-unsure", "Not sure"],
  ["decision-open", "Still open"],
];

const states = ["Default", "Hover", "Pressed", "Focus", "Disabled"] as const;

const stateProp = {
  Default: undefined,
  Hover: "hover",
  Pressed: "pressed",
  Focus: "focus",
  Disabled: undefined,
} as const;

function Specimen() {
  return (
    <div className="grid gap-4">
      <div className="text-label font-semibold tracking-[0.07em] text-fg-faint uppercase">
        Colour tokens
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2.5">
        {swatches.map(([token, use]) => (
          <div key={token} className="overflow-hidden rounded-ctl border border-line bg-chrome-2">
            <i className="block h-11" style={{ background: `var(--${token})` }} />
            <div className="px-2 py-1.5 text-label leading-snug text-fg-dim">
              <b className="block font-mono font-medium text-fg">{token}</b>
              {use}
            </div>
          </div>
        ))}
      </div>
      <div className="text-label font-semibold tracking-[0.07em] text-fg-faint uppercase">
        Buttons · states
      </div>
      <div className="flex flex-wrap items-end gap-2.5">
        {states.map((state) => (
          <div key={state} className="grid justify-items-start gap-1 text-label text-fg-faint">
            <Button variant="primary" state={stateProp[state]} disabled={state === "Disabled"}>
              Submit
            </Button>
            {state}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2.5">
        {states.map((state) => (
          <div key={state} className="grid justify-items-start gap-1 text-label text-fg-faint">
            <Button state={stateProp[state]} disabled={state === "Disabled"}>
              Cancel
              <Keycap keys="Esc" size="sm" />
            </Button>
            {state}
          </div>
        ))}
        <div className="grid justify-items-start gap-1 text-label text-fg-faint">
          <Button variant="ghost">Ghost</Button>
          Ghost
        </div>
      </div>
      <div className="text-label font-semibold tracking-[0.07em] text-fg-faint uppercase">
        Tool rail · states
      </div>
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="grid justify-items-start gap-1 text-label text-fg-faint">
          <ToolRailButton icon="select" label="Select" keyHint="V" />
          Default
        </div>
        <div className="grid justify-items-start gap-1 text-label text-fg-faint">
          <ToolRailButton icon="hand" label="Hand" keyHint="H" state="hover" />
          Hover
        </div>
        <div className="grid justify-items-start gap-1 text-label text-fg-faint">
          <ToolRailButton icon="ruler" label="Ruler" keyHint="L" defaultPressed />
          Active
        </div>
        <div className="grid justify-items-start gap-1 text-label text-fg-faint">
          <ToolRailButton icon="smart" label="Smart select" keyHint="S" ai />
          AI tool
        </div>
        <div className="grid justify-items-start gap-1 text-label text-fg-faint">
          <ToolRailButton icon="auto" label="Auto region" keyHint="U" ai defaultPressed />
          AI active
        </div>
      </div>
    </div>
  );
}

const keyedIcons: Array<[IconName, string, string]> = [
  ["select", "Select", "V"],
  ["hand", "Hand", "H"],
  ["smart", "Smart select", "S"],
  ["auto", "Auto region", "U"],
  ["poly", "Polygon", "P"],
  ["free", "Freehand", "⇧P"],
  ["rect", "Rectangle", "R"],
  ["ellipse", "Ellipse", "O"],
  ["marker", "Count marker", "M"],
  ["ruler", "Ruler", "L"],
  ["arrow", "Arrow", "⇧L"],
  ["text", "Text", "T"],
  ["comment", "Comment", "C"],
  ["brush", "Brush", "B"],
  ["slides", "Compare slides", ""],
  ["upload", "Upload", ""],
  ["sliders", "Display preset", "⇧1"],
  ["more", "More", ""],
  ["gear", "Settings", "⌘,"],
  ["help", "Shortcuts", "?"],
  ["flag", "AI area", "G"],
  ["warn", "Warning", ""],
  ["eye", "Overlays", "A"],
  ["lock", "Locked by the task", ""],
  ["search", "Find any action", "⌘K"],
  ["sun", "Slide brightness", "⌥↑"],
];

export const DesignSystem: Story = {
  name: "Design system",
  render: () => (
    <KitPage
      title="Design system"
      intro="The colour tokens, decision colours, sizes and component states of the mock as it is after round 6, in both themes."
    >
      <Frame label="Foundations / colour, components, states" flush>
        <div className="grid grid-cols-2">
          <div data-theme="dark" className="bg-chrome p-4.5 text-fg">
            <Specimen />
          </div>
          <div data-theme="light" className="bg-chrome p-4.5 text-fg">
            <Specimen />
          </div>
        </div>
      </Frame>
      <Grid2>
        <Frame label="Foundations / sizes and spacing">
          <RulesTable
            head={["Token", "Value", "Used for"]}
            rows={[
              ["space-zone", "28 px", "Between zones"],
              ["space-in", "10 px", "Between rows inside a zone"],
              ["pad-zone", "18 px", "Padding of a zone"],
              ["pad-modal", "24 px", "Padding of a flow page zone. A small modal uses 20 px"],
              ["r-zone", "12 px", "Corner of zones, menus and floating panels"],
              ["r-ctl", "8 px", "Corner of buttons and fields"],
              ["h-sm, h-md, h-lg", "28, 32 and 40 px", "Control heights"],
              ["tag-h, count-h", "20 and 16 px", "Every tag and every count"],
            ]}
          />
        </Frame>
        <Frame label="Foundations / class colours and rules">
          <div className="flex flex-wrap gap-3.5 text-body-sm">
            {projectClasses.map((projectClass, index) => (
              <span key={projectClass.name} className="inline-flex items-center gap-1.5">
                <i className="size-3.5 rounded-[3px]" style={{ background: projectClass.color }} />
                {projectClass.name.toLowerCase()} · {index + 1}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <i className="size-3.5 rounded-[3px] bg-c-prop outline-[1.5px] -outline-offset-1 outline-white outline-dashed" />
              AI proposal
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-3.5 rounded-[3px] bg-accent-fill" />
              UI accent
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-3.5 rounded-[3px] bg-[repeating-linear-gradient(-45deg,#ffffff_0_2px,#3a3a3a_2px_5px)] outline-[1.5px] -outline-offset-1 outline-white outline-dashed" />
              unsure, hatched or dashed white
            </span>
          </div>
        </Frame>
      </Grid2>
      <Frame label="Foundations / icons with their keys">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
          {keyedIcons.map(([name, label, key]) => (
            <div
              key={name}
              className="grid justify-items-center gap-1 rounded-ctl border border-line px-1 py-2.5 text-center text-label text-fg-dim"
            >
              <Icon name={name} size="md" className="text-fg" />
              <span>{label}</span>
              {key ? <Keycap keys={key} size="sm" /> : null}
            </div>
          ))}
        </div>
      </Frame>
      <Frame label="Progress / one bar, one ring">
        <div className="grid max-w-96 gap-3">
          <ProgressBar label="S26-04812_A1_HE.svs" valueText="50%" value={50} />
          <ControlRow
            label="Confidence"
            locked={{ value: "Hidden", reason: "Locked by RT-14: confidence hidden this round" }}
          />
        </div>
      </Frame>
    </KitPage>
  ),
};
