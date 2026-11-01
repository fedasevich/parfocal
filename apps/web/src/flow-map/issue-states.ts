import { linkOptions } from "@tanstack/react-router";
import { onboardingScenes } from "../screens/onboarding/scenes.ts";
import { mockScenes } from "../screens/scenes.ts";
import { sectionOfScene } from "../screens/settings/sections.ts";
import type { PrototypeScreen } from "./built-screens.ts";
import type { PersonaKey } from "./review-flow.ts";
import { type ScenarioIds, targetFor } from "./targets.ts";

export const issueStatesTitle = "Issue states";

export type IssueRow = {
  screen: PrototypeScreen;
  scene: string;
  label: string;
  detail: string;
  plain?: boolean;
  also?: "case" | "layers";
};

export type IssueGroup = { flow: string; rows: IssueRow[] };

export const issueGroups: IssueGroup[] = [
  {
    flow: "Upload",
    rows: [
      {
        screen: "upload",
        scene: "dup",
        label: "Duplicate slide",
        detail: "A slide that is already in P07 asks to skip it or replace it",
      },
      {
        screen: "upload",
        scene: "storagefull",
        label: "Storage full",
        detail:
          "Check says 11.4 GB is needed and P07 has 3.8 GB left of its allowance, so the upload waits",
      },
      {
        screen: "upload",
        scene: "unmatched",
        label: "Unmatched result at Check",
        detail: "A heatmap with no slide, to pick one or leave it out",
      },
      {
        screen: "upload",
        scene: "sourceoff",
        label: "Source offline mid-upload",
        detail: "The S3 source stopped answering, 2 slides wait and the rest go on",
      },
    ],
  },
  {
    flow: "Project",
    rows: [
      {
        screen: "project",
        scene: "importfail",
        label: "Import failed",
        detail: "A result file landed outside its slide and nothing was changed",
      },
    ],
  },
  {
    flow: "New review task",
    rows: [
      {
        screen: "task",
        scene: "noresult",
        label: "No result set on the picked slides",
        detail: "None of the picked slides has the result set, so Next is off",
      },
      {
        screen: "task",
        scene: "pastdue",
        label: "Due date in the past",
        detail: "The due date is in the past",
      },
      {
        screen: "task",
        scene: "away",
        label: "A reviewer is away",
        detail: "A picked reviewer is away until 22 Oct, a warning only",
      },
      {
        screen: "task",
        scene: "retiredtpl",
        label: "The template was retired",
        detail: "The project's default template was retired",
      },
      {
        screen: "task",
        scene: "nobody",
        label: "Nobody picked, Next disabled",
        detail: "No reviewer picked yet",
      },
    ],
  },
  {
    flow: "Reviewing a slide",
    rows: [
      {
        screen: "guided",
        scene: "slidefail",
        label: "Slide fails to load",
        detail: "A1 can't be read at 20x and 40x, lower levels still show",
        also: "case",
      },
      {
        screen: "guided",
        scene: "noresults",
        label: "No results",
        detail: "tumor_052 has no result yet, so there is nothing to decide",
        also: "case",
      },
      {
        screen: "guided",
        scene: "connlost",
        label: "Connection lost",
        detail: "Decisions can't be saved, nothing is lost and it retries by itself",
        also: "case",
      },
      {
        screen: "guided",
        scene: "withdrawn",
        label: "The task was withdrawn",
        detail: "Daniel withdrew RT-14, the 7 decided slides are kept",
        also: "case",
      },
      {
        screen: "guided",
        scene: "signedoff",
        label: "Read-only after sign-off",
        detail: "Signed off 15 Oct, the answers are read-only",
        also: "case",
      },
    ],
  },
  {
    flow: "Loading and sources",
    rows: [
      {
        screen: "case",
        scene: "loading",
        label: "Tiles loading",
        detail: "The coarse level shows first and sharper tiles fade in",
        plain: true,
      },
      {
        screen: "case",
        scene: "unloaded",
        label: "Not loaded yet",
        detail: "A quiet checker where nothing has loaded yet",
        plain: true,
      },
      {
        screen: "case",
        scene: "slow",
        label: "Slow source",
        detail: "The scanner archive answers slowly, the hint names it",
      },
      {
        screen: "case",
        scene: "remoteoff",
        label: "Remote source offline",
        detail: "The source is offline, the slide opens from the tile cache",
      },
    ],
  },
  {
    flow: "Display panel",
    rows: [
      {
        screen: "guided",
        scene: "locked",
        label: "Display, a setting locked by the task",
        detail: "A setting locked by RT-14 shows its reason",
        plain: true,
        also: "layers",
      },
    ],
  },
  {
    flow: "Submit",
    rows: [
      {
        screen: "guided",
        scene: "skipped",
        label: "Skipped objects",
        detail: "Objects and cells still open, each with a Go to link",
      },
      {
        screen: "guided",
        scene: "required",
        label: "A required question",
        detail: "Question 1 is not answered",
      },
      {
        screen: "guided",
        scene: "submitfail",
        label: "Submit failed",
        detail: "The review could not be submitted, every decision is saved",
        also: "case",
      },
    ],
  },
  {
    flow: "Disagreements",
    rows: [
      {
        screen: "disagree",
        scene: "lockedqueue",
        label: "Queue locked until everyone submits",
        detail: "The queue opens when every reviewer has submitted",
      },
      {
        screen: "disagree",
        scene: "declined",
        label: "The adjudicator declined",
        detail: "Anna Kopecká declined the objects sent to her",
      },
      {
        screen: "disagree",
        scene: "edited",
        label: "An object edited after a decision",
        detail: "T2 was redrawn after both reviewers decided",
      },
    ],
  },
  {
    flow: "Sign-off",
    rows: [
      {
        screen: "signoff",
        scene: "blocked",
        label: "Blockers",
        detail: "Reviews and disagreements still open, each with a Go to link",
      },
      {
        screen: "signoff",
        scene: "ssofail",
        label: "SSO failed",
        detail: "Vltava single sign-on did not answer, nothing was signed",
      },
      {
        screen: "signoff",
        scene: "amend",
        label: "An amendment needs a reason",
        detail: "Starting v2 needs a reason for the change",
      },
    ],
  },
  {
    flow: "Evaluation report",
    rows: [
      {
        screen: "evaluation",
        scene: "retiredtpl",
        label: "Retired template",
        detail: "The report keeps its retired template v2, new tasks use v3",
      },
      {
        screen: "evaluation",
        scene: "exportfail",
        label: "Export failed",
        detail: "The PDF could not be made, the CSV files still download",
      },
    ],
  },
  {
    flow: "Clinical report",
    rows: [
      {
        screen: "creport",
        scene: "missing",
        label: "A required field is empty",
        detail: "A required field is empty, so Sign out is off",
      },
      {
        screen: "creport",
        scene: "unmeasured",
        label: "A deposit is not measured",
        detail: "A deposit has no size yet",
      },
      {
        screen: "creport",
        scene: "dephand",
        label: "A hand measurement is incomplete",
        detail: "A hand measurement needs a size above 0",
      },
      {
        screen: "creport",
        scene: "amend",
        label: "An amendment needs a reason",
        detail: "An amendment needs a reason",
      },
      {
        screen: "creport",
        scene: "ssofail",
        label: "SSO failed",
        detail: "Single sign-on did not answer, nothing was signed",
      },
    ],
  },
  {
    flow: "Team",
    rows: [
      {
        screen: "team",
        scene: "overdue",
        label: "A task is overdue",
        detail: "RT-14 is past its due date",
      },
      {
        screen: "team",
        scene: "away",
        label: "A reviewer is away",
        detail: "A reviewer is away, the task waits for her",
      },
      {
        screen: "team",
        scene: "partial",
        label: "Reassigning a task with partial progress",
        detail: "Reassigning a task with some slides done",
      },
    ],
  },
  {
    flow: "Settings, shortcuts",
    rows: [
      {
        screen: "settings",
        scene: "conflict",
        label: "Key already used",
        detail: "The key already does something else, swap it or take it",
      },
      {
        screen: "settings",
        scene: "reserved",
        label: "Kept by the browser",
        detail: "The browser keeps that key, so pick another",
      },
      {
        screen: "settings",
        scene: "safety",
        label: "Risky single key",
        detail: "A key that changes the report needs ⌘ or ⌃",
      },
    ],
  },
  {
    flow: "Admin, connect a model",
    rows: [
      {
        screen: "connectmodel",
        scene: "addfail",
        label: "Test found a problem",
        detail: "The test answer is not Parfocal JSON, 38 cells have no geometry",
      },
    ],
  },
  {
    flow: "Sign in",
    rows: [
      {
        screen: "signin",
        scene: "expired",
        label: "Session expired",
        detail: "The session ended after 8 hours, sign-in returns to T5",
      },
      {
        screen: "signin",
        scene: "noaccess",
        label: "No access",
        detail: "Signed in, but not a member of Lymph nodes 2026",
      },
    ],
  },
];

export const issueStateCount = issueGroups.reduce((sum, group) => sum + group.rows.length, 0);

const researcherScreens: ReadonlySet<PrototypeScreen> = new Set<PrototypeScreen>([
  "connectmodel",
  "upload",
  "project",
  "task",
  "team",
  "disagree",
  "signoff",
  "evaluation",
]);

export const issueWho = (screen: PrototypeScreen): PersonaKey =>
  researcherScreens.has(screen) ? "DH" : "LM";

function oneOf<Known extends string>(known: readonly Known[], scene: string): Known | undefined {
  return (known as readonly string[]).includes(scene) ? (scene as Known) : undefined;
}

export function issueTarget(screen: PrototypeScreen, scene: string, ids: ScenarioIds) {
  const as = issueWho(screen);
  if (screen === "layers") return null;
  if (screen === "settings") {
    const known = oneOf(mockScenes.settings, scene);
    return known === undefined
      ? null
      : linkOptions({
          to: "/settings/$section",
          params: { section: sectionOfScene(known) },
          search: { scene: known, as },
        });
  }
  if (screen === "signin") {
    return linkOptions({
      to: "/sign-in",
      search: { scene: oneOf(onboardingScenes.signin, scene), as },
    });
  }
  if (screen === "connectmodel") {
    return linkOptions({
      to: "/admin",
      search: { scene: oneOf(onboardingScenes.admin, scene), as },
    });
  }
  return targetFor(screen, ids, { scene, as });
}
