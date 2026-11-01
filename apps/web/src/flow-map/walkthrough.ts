import type { MapScreen, PersonaKey } from "./review-flow.ts";

export type WalkScreen = MapScreen | "home" | "project";

export type WalkStep = {
  screen: WalkScreen;
  scene?: string;
  who?: PersonaKey;
  text: string;
};

export type Chapter = {
  title: string;
  who: PersonaKey;
  role?: string;
  clinical?: boolean;
  shows: string;
  steps: WalkStep[];
};

export const chapters: Chapter[] = [
  {
    title: "Upload",
    who: "DH",
    shows:
      "The drop, the grouped list, the problems step with one fix, the upload, the two slides without results",
    steps: [
      {
        screen: "home",
        text: "Start with Upload. The same button sits in the top bar and on every project.",
      },
      {
        screen: "upload",
        scene: "empty",
        text: "One drop area for slides, results or a whole folder. Next to it, the folder shape Parfocal understands.",
      },
      {
        screen: "upload",
        scene: "files",
        text: "Upload is a page with three steps. The files show as one list, grouped by case and slide, and each result sits under the slide it was matched to. The heatmap waits in Not matched yet. Next, check.",
      },
      {
        screen: "upload",
        scene: "check",
        text: "The totals first, then one zone per problem with its fix. Import the 409 good objects.",
      },
      {
        screen: "upload",
        scene: "check",
        text: "The button says what happens: the other two wait for a fix, the rest upload. Start the upload.",
      },
      {
        screen: "upload",
        scene: "progress",
        text: "One bar per file and one for everything. Files and Check are locked now. You can leave the page and it keeps going. In the mock, jump to the end.",
      },
      {
        screen: "upload",
        scene: "done",
        text: "Two slides came without results. Run a model on them.",
      },
    ],
  },
  {
    title: "Run a model",
    who: "DH",
    shows: "Pick and run, then the jobs tray",
    steps: [
      {
        screen: "runmodel",
        scene: "pick",
        text: "The slides without results are picked. Choose a model, see how long it takes, run.",
      },
      {
        screen: "project",
        text: "The run and the upload live in the jobs tray. Close it and carry on.",
      },
    ],
  },
  {
    title: "New review task",
    who: "DH",
    shows: "Five steps with the decision style and its Counts as line, then Send",
    steps: [
      {
        screen: "project",
        text: "From the project, hand the slides to reviewers as a review task.",
      },
      {
        screen: "task",
        scene: "slides",
        text: "Five short steps. First the slides and the AI result to check.",
      },
      {
        screen: "task",
        scene: "reviewers",
        text: "Pick the reviewers. Everyone reviews all gives agreement numbers.",
      },
      {
        screen: "task",
        scene: "decision",
        text: "Tumor regions and 50 random cells per slide. Below them, the decision question and its Counts as line: on the 5-point scale, 4 and 5 count as agree.",
      },
      {
        screen: "task",
        scene: "how",
        text: "Blind by default, guided review for the reviewers, due Friday.",
      },
      {
        screen: "task",
        scene: "send",
        text: "Every choice in one list, with a Change link back to each step. Send the task, and the reviewers are told.",
      },
    ],
  },
  {
    title: "Watching progress",
    who: "DH",
    shows: "Team and a nudge",
    steps: [
      {
        screen: "team",
        scene: "sent",
        text: "Team shows every open task and how far each reviewer is. Simona is behind on RT-14. Nudge her.",
      },
      {
        screen: "team",
        scene: "nudge",
        text: "The message says how far she is and when the task is due. Send it.",
      },
    ],
  },
  {
    title: "Review",
    who: "LM",
    shows:
      "My work, guided review, agree and disagree with a reason, a comment, the cells panel, the Slide done card with a blocker, the fix, Submit and the next slide",
    steps: [
      { screen: "worklist", scene: "review", text: "My work opens with one Continue button." },
      {
        screen: "guided",
        scene: "region",
        text: "One object at a time. T1 is tumor: Agree, or press K.",
      },
      {
        screen: "guided",
        scene: "region",
        text: "T2 runs past the capsule. Disagree, or press X.",
      },
      { screen: "guided", scene: "disagree", text: "Say what is wrong. The boundary is off." },
      {
        screen: "guided",
        scene: "comments",
        text: "Something to discuss? The Comments tab holds the thread for this object, the same one the full viewer shows.",
      },
      {
        screen: "guided",
        scene: "comments",
        text: "Read, write or @mention someone here. Back to Review for the next object.",
      },
      {
        screen: "guided",
        scene: "region",
        text: "The dots are the five regions, and the last one is the 50 sampled cells. Leave T3 for later and jump to the open cell.",
      },
      {
        screen: "guided",
        scene: "grid",
        text: "Cells are judged on the slide. The open cell is centred and outlined, and the small panel below moves between the 50 cells. Agree.",
      },
      {
        screen: "guided",
        scene: "required",
        text: "The Slide done card lists what blocks the submit: T3 is still open and two questions are not answered. Go to T3.",
      },
      {
        screen: "guided",
        scene: "region",
        text: "T3 is tumor. Agree, and every object on the slide is decided.",
      },
      {
        screen: "guided",
        scene: "done",
        text: "Two questions are required. How acceptable is the AI result? Pick 4.",
      },
      {
        screen: "guided",
        scene: "done",
        text: "Would you sign it without changes? No, the T2 boundary needs a fix. The other two questions are optional.",
      },
      {
        screen: "guided",
        scene: "done",
        text: "Nothing blocks the submit now. Submit, and the next slide is ready.",
      },
      {
        screen: "next",
        text: "Your review is in. You can change it until Daniel signs off. Take a break whenever you need.",
      },
    ],
  },
  {
    title: "Disagreements",
    who: "DH",
    shows: "The queue, one decision, three objects sent to Anna, two left open",
    steps: [
      {
        screen: "worklist",
        scene: "assigned",
        text: "Both reviewers submitted RT-14. It has 7 disagreements to resolve.",
      },
      {
        screen: "disagree",
        scene: "queue",
        text: "The AI and both reviewers side by side, the reviewers by name. Decide T2 with the task's own buttons.",
      },
      {
        screen: "disagree",
        scene: "selected",
        text: "Some need a second opinion. Tick T4.",
      },
      { screen: "disagree", scene: "selected", text: "And T5." },
      { screen: "disagree", scene: "selected", text: "And the cell T1·C145." },
      { screen: "disagree", scene: "sendadj", text: "Send the three to an adjudicator." },
      {
        screen: "disagree",
        scene: "sendadj",
        text: "Pick Anna Kopecká to decide. She sees Reviewer A and Reviewer B, not the names.",
      },
      {
        screen: "disagree",
        scene: "sent",
        text: "Send them. The other three stay open for now, and sign-off will list them.",
      },
    ],
  },
  {
    title: "Adjudication",
    who: "AK",
    shows: "One decision after another until all are decided",
    steps: [
      {
        screen: "worklist",
        scene: "anna",
        text: "Anna's My work shows the three objects Daniel sent her. Start.",
      },
      {
        screen: "disagree",
        scene: "adjudicate",
        text: "One object at a time, the reviewers anonymous. T4 is a reactive sinus, not tumor. Disagree with the AI.",
      },
      { screen: "disagree", scene: "adjudicate", text: "T5 is tumor. Agree." },
      {
        screen: "disagree",
        scene: "adjudicate",
        text: "The cell T1·C145 too. Agree, and all three are decided.",
      },
      {
        screen: "disagree",
        scene: "adjdone",
        text: "Her decisions go back to Daniel's queue. Done for now.",
      },
    ],
  },
  {
    title: "Sign-off and report",
    who: "DH",
    shows: "Blockers, ready, signing with SSO, the signed state, the report and the PDF",
    steps: [
      {
        screen: "signoff",
        scene: "blocked",
        text: "Earlier, sign-off showed what blocked it, each with a Go to link: Simona had slides left and the queue was open.",
      },
      {
        screen: "signoff",
        scene: "ready",
        text: "Now everything is in. Three objects stay open on purpose and the report says so. Sign with Vltava SSO.",
      },
      {
        screen: "signoff",
        scene: "signed",
        text: "Evaluation v1 is signed, with exports and a log of any later change. Open the report.",
      },
      {
        screen: "evaluation",
        scene: "report",
        text: "The report is shown as its pages, laid out by the study template: agreement, errors by reason and every object by ID. Preview the PDF.",
      },
      {
        screen: "evaluation",
        scene: "pdf",
        text: "The exact file co-authors get, with thumbnails and zoom. Download it.",
      },
    ],
  },
  {
    title: "Clinical report",
    who: "LM",
    role: "pathologist",
    clinical: true,
    shows:
      "Findings, staging with several deposits, the report text, sign-out, and the co-sign path",
    steps: [
      {
        screen: "case",
        scene: "objects",
        text: "Lymph nodes 2026 is a clinical project. Lenka reviews her case in the same viewer, and the top bar says Open report instead of Submit.",
      },
      {
        screen: "creport",
        scene: "findings",
        text: "The clinical report is a flow page. Findings come from the decisions on the slide. Next.",
      },
      {
        screen: "creport",
        scene: "deposits",
        text: "Every deposit is a row, from an object on a slide or measured by hand. The largest, 8.0 mm, sets the suggested category, which stays a suggestion until you pick it. Macrometastasis.",
      },
      {
        screen: "creport",
        scene: "deposits",
        text: "Extranodal extension: absent.",
      },
      { screen: "creport", scene: "staging", text: "The suggested pN follows. Next." },
      {
        screen: "creport",
        scene: "text",
        text: "The report text is filled in, with chips that insert measurements from the slide. Next.",
      },
      {
        screen: "creport",
        scene: "sign",
        text: "Lenka has the Can sign out right in this project. Sign out.",
      },
      {
        screen: "creport",
        scene: "sign",
        text: "Sign with Vltava SSO. The report leaves for the clinician.",
      },
      {
        screen: "creport",
        scene: "signed",
        text: "Signed out, with Download PDF and Amend with a reason. Now the other path: Tomáš Beneš wrote the report and cannot sign out here.",
      },
      {
        screen: "creport",
        scene: "cosign",
        who: "TB",
        text: "Without the right, the step offers Send for co-sign. Pick Lenka, who can sign out.",
      },
      {
        screen: "creport",
        scene: "cosign",
        who: "TB",
        text: "Send it. Lenka sees it in My work.",
      },
      {
        screen: "creport",
        scene: "sent",
        who: "TB",
        text: "Sent and waiting. Tomáš can withdraw it until Lenka acts.",
      },
      {
        screen: "cosign",
        scene: "review",
        text: "Lenka sees Tomáš's values next to her own and the AI's. Changed rows highlight. Co-sign and sign out.",
      },
      {
        screen: "cosign",
        scene: "review",
        text: "The same signing dialog. The signed report names both: reported by Tomáš, verified and signed by Lenka.",
      },
    ],
  },
];

export const stepCount = chapters.reduce((total, chapter) => total + chapter.steps.length, 0);

export type StepRef = { chapter: number; step: number };

export function stepAt({ chapter, step }: StepRef) {
  return chapters[chapter]?.steps[step];
}

export function nextStep({ chapter, step }: StepRef): StepRef | null {
  const current = chapters[chapter];
  if (current === undefined) return null;
  if (step + 1 < current.steps.length) return { chapter, step: step + 1 };
  return chapter + 1 < chapters.length ? { chapter: chapter + 1, step: 0 } : null;
}

export function previousStep({ chapter, step }: StepRef): StepRef | null {
  if (step > 0) return { chapter, step: step - 1 };
  const previous = chapters[chapter - 1];
  return previous === undefined ? null : { chapter: chapter - 1, step: previous.steps.length - 1 };
}

export function stepWho({ chapter, step }: StepRef): PersonaKey | undefined {
  const current = chapters[chapter];
  return current?.steps[step]?.who ?? current?.who;
}

export function stepRole(ref: StepRef, roles: Record<PersonaKey, string>): string | undefined {
  const current = chapters[ref.chapter];
  const who = stepWho(ref);
  if (current === undefined || who === undefined) return undefined;
  return who === current.who && current.role !== undefined ? current.role : roles[who];
}
