export type PersonaKey = "DH" | "LM" | "AK" | "TB";

export type LaneKey = "res" | "rev" | "adj" | "cli";

export type MapScreen =
  | "upload"
  | "runmodel"
  | "task"
  | "team"
  | "disagree"
  | "signoff"
  | "evaluation"
  | "worklist"
  | "guided"
  | "case"
  | "gallery"
  | "next"
  | "creport"
  | "cosign";

export type Lane = {
  key: LaneKey;
  who: PersonaKey[];
  role: string;
  note: string;
  rows: number;
  gapBefore?: number;
};

export type MapBox = {
  id: string;
  lane: LaneKey;
  column: number;
  row?: number;
  span?: number;
  title: string;
  sub: string;
  screen: MapScreen;
  scene?: string;
  who: PersonaKey;
  clinical?: boolean;
  submitted?: boolean;
};

export const personaRoles: Record<PersonaKey, string> = {
  DH: "researcher",
  LM: "reviewer",
  AK: "adjudicator",
  TB: "pathologist",
};

export const mapTitle = "How a review works";

export const mapDescription =
  "Each box opens that screen in that state. A plain arrow is the next step by the same person. An arrow with a label is a hand-off to someone else.";

export const clinicalNote =
  "Only a project in Clinical privacy mode has a clinical report, one per case. Signing out is a project right, Can sign out, set per member as own cases, any case or never. A member without it sends the report to someone who has it.";

export const waitLabel = "Reviewers work on their slides";

export const lanes: Lane[] = [
  {
    key: "res",
    who: ["DH"],
    role: "Researcher",
    note: "Sets up the review and signs off the evaluation",
    rows: 1,
  },
  { key: "rev", who: ["LM"], role: "Reviewer", note: "", rows: 2 },
  {
    key: "adj",
    who: ["AK"],
    role: "Adjudicator",
    note: "Decides what the reviewers disagree on. She does not see who said what",
    rows: 1,
  },
  {
    key: "cli",
    who: ["LM", "TB"],
    role: "Clinical project only",
    note: "Lenka can sign out here, Tomáš cannot",
    rows: 2,
    gapBefore: 14,
  },
];

export const boxes: MapBox[] = [
  {
    id: "upload",
    lane: "res",
    column: 0,
    title: "Upload",
    sub: "Slides and results",
    screen: "upload",
    scene: "files",
    who: "DH",
  },
  {
    id: "runmodel",
    lane: "res",
    column: 1,
    title: "Run a model",
    sub: "Where results are missing",
    screen: "runmodel",
    scene: "pick",
    who: "DH",
  },
  {
    id: "task",
    lane: "res",
    column: 2,
    title: "New review task",
    sub: "5 steps",
    screen: "task",
    scene: "slides",
    who: "DH",
  },
  {
    id: "team",
    lane: "res",
    column: 3,
    title: "Team",
    sub: "Progress and nudges",
    screen: "team",
    scene: "open",
    who: "DH",
  },
  {
    id: "disagree",
    lane: "res",
    column: 6,
    span: 2,
    title: "Disagreements",
    sub: "Decide where the reviewers differ",
    screen: "disagree",
    scene: "queue",
    who: "DH",
  },
  {
    id: "signoff",
    lane: "res",
    column: 8,
    title: "Sign-off",
    sub: "Freezes the evaluation",
    screen: "signoff",
    scene: "ready",
    who: "DH",
  },
  {
    id: "evaluation",
    lane: "res",
    column: 9,
    title: "Evaluation report",
    sub: "Also as a PDF",
    screen: "evaluation",
    scene: "report",
    who: "DH",
  },
  {
    id: "worklist",
    lane: "rev",
    column: 2,
    title: "My work",
    sub: "Tasks and due dates",
    screen: "worklist",
    scene: "review",
    who: "LM",
  },
  {
    id: "guided",
    lane: "rev",
    column: 3,
    title: "Guided review",
    sub: "One object at a time",
    screen: "guided",
    scene: "region",
    who: "LM",
  },
  {
    id: "case",
    lane: "rev",
    column: 3,
    row: 1,
    title: "Full viewer",
    sub: "Every tool, same review",
    screen: "case",
    scene: "objects",
    who: "LM",
  },
  {
    id: "gallery",
    lane: "rev",
    column: 4,
    title: "Decide objects",
    sub: "Regions, then cells on the slide",
    screen: "gallery",
    scene: "grid",
    who: "LM",
  },
  {
    id: "done",
    lane: "rev",
    column: 5,
    title: "Slide done",
    sub: "Two questions, then submit",
    screen: "guided",
    scene: "done",
    who: "LM",
  },
  {
    id: "next",
    lane: "rev",
    column: 6,
    title: "Submit, next slide",
    sub: "Then slide 9",
    screen: "next",
    who: "LM",
  },
  {
    id: "reopen",
    lane: "rev",
    column: 6,
    row: 1,
    title: "Reopen until sign-off",
    sub: "Changes saved",
    screen: "guided",
    scene: "region",
    who: "LM",
    submitted: true,
  },
  {
    id: "adjudicate",
    lane: "adj",
    column: 7,
    span: 2,
    title: "Decide queued objects",
    sub: "The reviewers stay anonymous",
    screen: "disagree",
    scene: "adjudicate",
    who: "AK",
  },
  {
    id: "ccase",
    lane: "cli",
    column: 0,
    title: "Review the case",
    sub: "Objects tab",
    screen: "case",
    scene: "objects",
    who: "LM",
    clinical: true,
  },
  {
    id: "creport",
    lane: "cli",
    column: 1,
    title: "Clinical report",
    sub: "4 steps",
    screen: "creport",
    scene: "findings",
    who: "LM",
  },
  {
    id: "crsign",
    lane: "cli",
    column: 2,
    title: "Sign out",
    sub: "By Lenka",
    screen: "creport",
    scene: "sign",
    who: "LM",
  },
  {
    id: "crcosign",
    lane: "cli",
    column: 2,
    row: 1,
    title: "Send for co‑sign",
    sub: "By Tomáš",
    screen: "creport",
    scene: "cosign",
    who: "TB",
  },
  {
    id: "cosign",
    lane: "cli",
    column: 4,
    row: 1,
    title: "Co‑sign review",
    sub: "By Lenka",
    screen: "cosign",
    scene: "review",
    who: "LM",
  },
  {
    id: "signed",
    lane: "cli",
    column: 5,
    title: "Signed out",
    sub: "Amend with a reason",
    screen: "creport",
    scene: "amended",
    who: "LM",
  },
];

export const builtScreens: ReadonlySet<MapScreen> = new Set<MapScreen>([
  "team",
  "task",
  "guided",
  "gallery",
  "next",
]);

export const isBuilt = (box: MapBox) => builtScreens.has(box.screen);
