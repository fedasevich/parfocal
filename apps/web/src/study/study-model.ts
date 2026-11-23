import { z } from "zod";
import { type ParticipantProject, participantTokens } from "./participant-project.ts";

const validPattern = (pattern: string) => {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
};

export const taskCheckSchema = z
  .object({
    path: z.string().min(1).refine(validPattern, { message: "check.path is not a valid pattern" }),
    selector: z.string().min(1),
    text: z.string().min(1).refine(validPattern, { message: "check.text is not a valid pattern" }),
    minCount: z.number().int().positive(),
  })
  .partial()
  .refine((check) => check.path ?? check.selector ?? check.text, {
    message: "A check needs a path, a selector or a text",
  });

export type TaskCheck = z.infer<typeof taskCheckSchema>;

export const taskGuardSchema = z.object({
  stayOn: z
    .array(
      z.string().min(1).refine(validPattern, { message: "guard.stayOn is not a valid pattern" }),
    )
    .min(1),
  where: z.string().min(1),
});

export type TaskGuard = z.infer<typeof taskGuardSchema>;

export const studyTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  instruction: z.string().min(1),
  slide: z.string().min(1).optional(),
  startPath: z.string().startsWith("/").optional(),
  targetSeconds: z.number().int().positive().optional(),
  check: taskCheckSchema.optional(),
  guard: taskGuardSchema.optional(),
});

export type StudyTask = z.infer<typeof studyTaskSchema>;

export const taskSetSchema = z
  .array(studyTaskSchema)
  .min(1)
  .refine((tasks) => new Set(tasks.map((task) => task.id)).size === tasks.length, {
    message: "Task ids must be unique",
  });

export type Outcome = "done" | "gave-up" | "skipped";

export type TaskResult = {
  taskId: string;
  startedAt: number;
  endedAt: number;
  outcome: Outcome;
  auto?: boolean | undefined;
};

export type BlockedAttempt = { taskId: string; at: number; to: string };

export const taskNoteKeys = ["like", "dislike", "recommend"] as const;

export type TaskNoteKey = (typeof taskNoteKeys)[number];

export type TaskNotes = Partial<Record<TaskNoteKey, string | undefined>>;

export type TaskRecord = {
  id: string;
  idx: number;
  title: string;
  goal: string;
  success: boolean;
  durationMs: number;
  clicks: number;
  deadClicks: number;
  blocked: number;
  keys: number;
  wheels: number;
  seq: number | null;
  notes: TaskNotes;
  reason: string | null;
  endedAt: number;
};

export const finalTextKeys = ["like", "dislike", "missing", "recommend"] as const;

export type FinalTextKey = (typeof finalTextKeys)[number];

export type AnswerChange = {
  key: string;
  from: string | number;
  to: string | number;
  at: number;
};

export type FinalAnswers = {
  sus: (number | null)[];
  susScore: number | null;
  open: Partial<Record<FinalTextKey, string | undefined>>;
  changes: AnswerChange[];
  finishedAt: number | null;
};

export type StudySession = {
  id: string;
  round: number;
  participant: string;
  startedAt: number;
  results: TaskResult[];
  blocks: BlockedAttempt[];
  consentAt?: number | undefined;
  tasks?: TaskRecord[] | undefined;
  final?: FinalAnswers | undefined;
};

export type ActiveGuard = {
  sessionId: string;
  taskId: string;
  where: string;
  stayOn: string[];
};

export type Round = { number: number; tasks: StudyTask[] };

export type StudyState = { rounds: Round[]; sessions: StudySession[] };

export const studySlide = "tumor_044";

const reviewSlide = "/projects/{project}/slides/{slide}?task={task}&as=DH";
const cellFindings = "/projects/{taskProject}/slides/{taskSlide}?task={task}&object=T1·C145";
const cellGuard: TaskGuard = {
  stayOn: ["^/projects/{taskProject}/slides/{taskSlide}(/|$)"],
  where: "This task happens on the slide's cell findings screen. Stay on it until you are done.",
};
const areaVisits = '[data-testid="area-visits"]';

export const pilotTasks: StudyTask[] = [
  {
    id: "t1",
    title: "Open the slide",
    instruction: `Open the ${studySlide} slide from the worklist.`,
    slide: studySlide,
    startPath: "/projects/{project}?tab=slides",
    targetSeconds: 30,
    check: {
      path: "/slides/{slide}(\\?|$)",
      selector: '[data-testid="slide-stage"][data-state="ready"]',
    },
  },
  {
    id: "t2",
    title: "Find the tumor",
    instruction: "Move the slide to the area you think holds tumor and zoom in on it.",
    slide: studySlide,
    startPath: reviewSlide,
    targetSeconds: 60,
    check: { selector: `${areaVisits}:not([data-visited=""])` },
  },
  {
    id: "t3",
    title: "Read the AI result",
    instruction: "Say in your own words what the coloured overlay shows.",
    slide: studySlide,
    startPath: reviewSlide,
    targetSeconds: 45,
  },
  {
    id: "t4",
    title: "Open the least sure zone",
    instruction: "Open the zone where the AI is least sure.",
    startPath: cellFindings,
    targetSeconds: 45,
    guard: cellGuard,
  },
  {
    id: "t5",
    title: "Answer four unsure cells",
    instruction: "Answer any four cells the AI is unsure about.",
    startPath: cellFindings,
    targetSeconds: 120,
    guard: cellGuard,
  },
  {
    id: "t6",
    title: "Change a lymphocyte",
    instruction: "Find a cell you can see is a lymphocyte and change the AI label to match.",
    startPath: cellFindings,
    targetSeconds: 60,
    check: {
      selector: '[data-testid="cell-type-bar"]:not([data-chosen=""]):not([data-chosen="keep"])',
    },
    guard: cellGuard,
  },
  {
    id: "t7",
    title: "Compare two results",
    instruction: "Put two AI results side by side and tell which one you trust more.",
    startPath: cellFindings,
    targetSeconds: 90,
  },
  {
    id: "t8",
    title: "Leave a comment",
    instruction: "Leave a comment on a region and mention a colleague.",
    slide: studySlide,
    startPath: reviewSlide,
    targetSeconds: 60,
  },
  {
    id: "t9",
    title: "Finish the slide",
    instruction: "Submit your review of this slide.",
    startPath: cellFindings,
    targetSeconds: 45,
  },
  {
    id: "t10",
    title: "Find the report",
    instruction: "Find the report and say what it counts.",
    startPath: "/tasks/{task}/evaluation",
    targetSeconds: 60,
  },
];

const reviewOnStudySlide = "/projects/{studyProject}/slides/{reviewSlide}?task={reviewTask}";
const cellOnStudySlide = "/projects/{studyProject}/slides/{cellSlide}?task={cellTask}";
const studyCellGuard: TaskGuard = {
  stayOn: ["^/projects/{studyProject}/slides/{cellSlide}(/|$)"],
  where: "This task happens on the slide's cell findings screen. Stay on it until you are done.",
};
const reviewSlideGuard: TaskGuard = {
  stayOn: ["^/projects/{studyProject}/slides/{reviewSlide}(/|$)"],
  where:
    "You do not need to leave this slide for this task. The goal is at the bottom of the screen.",
};

export const round5Tasks: StudyTask[] = [
  {
    id: "open-case",
    title: "Open the slide to review",
    instruction: "Find the slide that is waiting for your review in this project and open it.",
    startPath: "/projects/{studyProject}?tab=slides",
    check: { path: "/slides/{reviewSlide}(\\?|$)" },
  },
  {
    id: "patient-details",
    title: "Find the case details",
    instruction: "Open the case information and find the name of the doctor who sent this case in.",
    startPath: reviewOnStudySlide,
    guard: reviewSlideGuard,
  },
  {
    id: "unsure-place",
    title: "Go to the least sure place",
    instruction:
      "The AI is unsure about some cells on this slide. Go to the place where it is the least sure.",
    startPath: cellOnStudySlide,
    guard: studyCellGuard,
  },
  {
    id: "check-cells",
    title: "Answer four unsure cells",
    instruction:
      "The AI was unsure about some of the cells in this place. Give your answer for at least 4 of them. Any answer is fine.",
    startPath: cellOnStudySlide,
    guard: studyCellGuard,
  },
  {
    id: "change-type",
    title: "Change a cell to immune",
    instruction:
      "Find a cell the AI calls a tumor cell that you think is an immune cell. Change its type to immune.",
    startPath: cellOnStudySlide,
    check: {
      selector: '[data-testid="cell-type-bar"]:not([data-chosen=""]):not([data-chosen="keep"])',
    },
    guard: studyCellGuard,
  },
  {
    id: "whole-slide",
    title: "Look at the whole slide",
    instruction:
      "Quickly bring up a view of the entire tissue scan, then get back to the close-up you were looking at.",
    startPath: reviewOnStudySlide,
    guard: reviewSlideGuard,
  },
  {
    id: "compare",
    title: "Compare two slides",
    instruction: "This case has a second slide. Show it next to the slide you are reading.",
    startPath: reviewOnStudySlide,
    check: { path: "[?&]with=" },
  },
  {
    id: "add-scans",
    title: "Add new scans",
    instruction:
      "New scans for this patient have just arrived on your computer. Start adding them to this case.",
    startPath: reviewOnStudySlide,
    check: { path: "/upload(\\?|$)" },
  },
  {
    id: "sign-out",
    title: "Finish the review",
    instruction: "You have finished reviewing this slide. Submit your review.",
    startPath: reviewOnStudySlide,
  },
  {
    id: "queue-decision",
    title: "Settle a disagreement",
    instruction:
      "Two reviewers disagree about some slides. Open the first one and give your decision.",
    startPath: "/tasks/{queueTask}/disagreements",
  },
  {
    id: "annotate-area",
    title: "Outline a tumor area",
    instruction: "Draw an outline around one area of tumor on this slide and save it.",
    startPath: "/projects/{studyProject}/slides/{annotateSlide}/annotate-task?task={annotateTask}",
  },
];

export type StudyContext = {
  slides: { id: string; label: string; project: { id: string } }[];
  resume: { projectId: string; slideId: string; taskId: string } | null;
  participant?: ParticipantProject | null | undefined;
};

const fillTokens = (template: string, task: StudyTask, context: StudyContext) => {
  const slide = context.slides.find((row) => row.label === task.slide);
  const values: Record<string, string | undefined> = {
    project: slide?.project.id,
    slide: slide?.id,
    task: context.resume?.taskId,
    taskProject: context.resume?.projectId,
    taskSlide: context.resume?.slideId,
    ...participantTokens(context.participant),
  };
  let missing = false;
  const filled = template.replace(/\{(\w+)\}/g, (token, name: string) => {
    const value = values[name];
    if (value === undefined) missing = true;
    return value ?? token;
  });
  return missing ? undefined : filled;
};

export const resolveStartPath = (task: StudyTask, context: StudyContext): string | undefined =>
  task.startPath === undefined ? undefined : fillTokens(task.startPath, task, context);

export function resolveGuard(
  task: StudyTask,
  sessionId: string,
  context: StudyContext,
): ActiveGuard | undefined {
  if (task.guard === undefined) return undefined;
  const stayOn = [
    ...task.guard.stayOn,
    ...(task.check?.path === undefined ? [] : [task.check.path]),
  ]
    .map((pattern) => fillTokens(pattern, task, context))
    .filter((pattern): pattern is string => pattern !== undefined);
  if (stayOn.length === 0) return undefined;
  return { sessionId, taskId: task.id, where: task.guard.where, stayOn };
}

export const isBlocked = (guard: ActiveGuard, pathname: string): boolean =>
  !guard.stayOn.some((pattern) => new RegExp(pattern).test(pathname));

export type PageProbe = {
  url: string;
  count: (selector: string) => number;
  text: () => string;
};

export function checkMet(task: StudyTask, context: StudyContext, page: PageProbe): boolean {
  const { check } = task;
  if (check === undefined) return false;
  const minCount = check.minCount ?? 1;
  if (check.path !== undefined) {
    const path = fillTokens(check.path, task, context);
    if (path === undefined || !new RegExp(path).test(page.url)) return false;
  }
  if (check.selector !== undefined) {
    try {
      if (page.count(check.selector) < minCount) return false;
    } catch {
      return false;
    }
  }
  if (check.text !== undefined) {
    const matches = page.text().match(new RegExp(check.text, "g"))?.length ?? 0;
    if (matches < minCount) return false;
  }
  return true;
}

export const initialState = (): StudyState => ({
  rounds: [{ number: 1, tasks: round5Tasks }],
  sessions: [],
});

export const currentRound = (state: StudyState): Round => {
  const last = state.rounds[state.rounds.length - 1];
  if (last === undefined) throw new Error("A study always has a round");
  return last;
};

export const roundTasks = (state: StudyState, session: StudySession | undefined): StudyTask[] =>
  state.rounds.find((round) => round.number === session?.round)?.tasks ?? currentRound(state).tasks;

export const isFrozen = (state: StudyState, round: number): boolean =>
  state.sessions.some((session) => session.round === round) ||
  state.rounds.some((other) => other.number > round);

export type EditResult = { ok: true; state: StudyState } | { ok: false; reason: string };

export function parseTaskSet(
  json: string,
): { ok: true; tasks: StudyTask[] } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: "The task set is not valid JSON." };
  }
  const parsed = taskSetSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? "The task set is not valid." };
  }
  return { ok: true, tasks: parsed.data };
}

export function editTasks(state: StudyState, round: number, json: string): EditResult {
  if (isFrozen(state, round)) {
    return {
      ok: false,
      reason: "This round has sessions, so its tasks are frozen. Start the next round.",
    };
  }
  const parsed = parseTaskSet(json);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    state: {
      ...state,
      rounds: state.rounds.map((entry) =>
        entry.number === round ? { ...entry, tasks: parsed.tasks } : entry,
      ),
    },
  };
}

export function startNextRound(state: StudyState): StudyState {
  const last = currentRound(state);
  return {
    ...state,
    rounds: [...state.rounds, { number: last.number + 1, tasks: last.tasks }],
  };
}

export function startSession(
  state: StudyState,
  participant: string,
  id: string,
  now: number,
): StudyState {
  const session: StudySession = {
    id,
    round: currentRound(state).number,
    participant,
    startedAt: now,
    results: [],
    blocks: [],
  };
  return { ...state, sessions: [...state.sessions, session] };
}

export function recordResult(state: StudyState, sessionId: string, result: TaskResult): StudyState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === sessionId && !session.results.some((r) => r.taskId === result.taskId)
        ? { ...session, results: [...session.results, result] }
        : session,
    ),
  };
}

export function recordBlock(
  state: StudyState,
  sessionId: string,
  attempt: BlockedAttempt,
): StudyState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === sessionId &&
      !session.blocks.some((known) => known.taskId === attempt.taskId && known.at === attempt.at)
        ? { ...session, blocks: [...session.blocks, attempt] }
        : session,
    ),
  };
}

export const blockedCount = (session: StudySession, taskId: string): number =>
  session.blocks.filter((attempt) => attempt.taskId === taskId).length;

export const nextTask = (round: Round, session: StudySession): StudyTask | undefined =>
  round.tasks.find((task) => !session.results.some((result) => result.taskId === task.id));

export const durationSeconds = (result: TaskResult): number =>
  Math.max(0, Math.round((result.endedAt - result.startedAt) / 1000));

export type TaskSummary = {
  taskId: string;
  sessions: number;
  completed: number;
  medianSeconds: number | undefined;
  blocked: number;
};

const median = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export function summariseRound(state: StudyState, round: number): TaskSummary[] {
  const entry = state.rounds.find((candidate) => candidate.number === round);
  if (entry === undefined) return [];
  const sessions = state.sessions.filter((session) => session.round === round);
  return entry.tasks.map((task) => {
    const results = sessions.flatMap((session) =>
      session.results.filter((result) => result.taskId === task.id),
    );
    const done = results.filter((result) => result.outcome === "done");
    return {
      taskId: task.id,
      sessions: results.length,
      completed: done.length,
      medianSeconds: median(done.map(durationSeconds)),
      blocked: sessions.reduce((sum, session) => sum + blockedCount(session, task.id), 0),
    };
  });
}

export const susItemCount = 10;

export function susScore(sus: readonly (number | null)[]): number | null {
  if (sus.length !== susItemCount || sus.some((value) => value === null)) return null;
  return (
    2.5 *
    sus.reduce<number>(
      (sum, value, index) => sum + (index % 2 === 0 ? (value ?? 0) - 1 : 5 - (value ?? 0)),
      0,
    )
  );
}

const updateSession = (
  state: StudyState,
  sessionId: string,
  change: (session: StudySession) => StudySession,
): StudyState => ({
  ...state,
  sessions: state.sessions.map((session) => (session.id === sessionId ? change(session) : session)),
});

export function startParticipantSession(
  state: StudyState,
  code: string,
  id: string,
  at: number,
): StudyState {
  const started = startSession(state, code, id, at);
  return updateSession(started, id, (session) => ({ ...session, consentAt: at, tasks: [] }));
}

export function recordTask(
  state: StudyState,
  sessionId: string,
  record: TaskRecord,
  startedAt: number,
): StudyState {
  const withResult = recordResult(state, sessionId, {
    taskId: record.id,
    startedAt,
    endedAt: record.endedAt,
    outcome: record.success ? "done" : "gave-up",
  });
  return updateSession(withResult, sessionId, (session) =>
    (session.tasks ?? []).some((known) => known.id === record.id)
      ? session
      : { ...session, tasks: [...(session.tasks ?? []), record] },
  );
}

export function answerTask(
  state: StudyState,
  sessionId: string,
  taskId: string,
  seq: number,
  notes: TaskNotes,
): StudyState {
  return updateSession(state, sessionId, (session) => ({
    ...session,
    tasks: (session.tasks ?? []).map((record) =>
      record.id === taskId ? { ...record, seq, notes } : record,
    ),
  }));
}

export const emptyFinal = (): FinalAnswers => ({
  sus: Array.from({ length: susItemCount }, () => null),
  susScore: null,
  open: {},
  changes: [],
  finishedAt: null,
});

export type FinalPatch = {
  sus?: (number | null)[] | undefined;
  open?: Partial<Record<FinalTextKey, string | undefined>> | undefined;
};

export function answerFinal(
  state: StudyState,
  sessionId: string,
  patch: FinalPatch,
  at: number,
): StudyState {
  return updateSession(state, sessionId, (session) => {
    const final = session.final ?? emptyFinal();
    const changes: AnswerChange[] = [];
    const sus = final.sus.map((before, index) => {
      const after = patch.sus?.[index] ?? before;
      if (before !== null && after !== null && after !== before) {
        changes.push({ key: `sus${index + 1}`, from: before, to: after, at });
      }
      return after;
    });
    const open = { ...final.open };
    for (const key of finalTextKeys) {
      const after = patch.open?.[key];
      if (after === undefined) continue;
      const before = open[key];
      if (before !== undefined && before !== after) {
        changes.push({ key, from: before, to: after, at });
      }
      open[key] = after;
    }
    return {
      ...session,
      final: {
        ...final,
        sus,
        susScore: susScore(sus),
        open,
        changes: [...final.changes, ...changes],
      },
    };
  });
}

export function finishFinal(state: StudyState, sessionId: string, at: number): StudyState {
  return updateSession(state, sessionId, (session) => ({
    ...session,
    final: { ...(session.final ?? emptyFinal()), finishedAt: at },
  }));
}

const notesSchema = z.object({
  like: z.string().optional(),
  dislike: z.string().optional(),
  recommend: z.string().optional(),
});

const taskRecordSchema = z.object({
  id: z.string(),
  idx: z.number(),
  title: z.string(),
  goal: z.string(),
  success: z.boolean(),
  durationMs: z.number(),
  clicks: z.number(),
  deadClicks: z.number(),
  blocked: z.number(),
  keys: z.number(),
  wheels: z.number(),
  seq: z.number().nullable(),
  notes: notesSchema.default({}),
  reason: z.string().nullable(),
  endedAt: z.number(),
});

const finalSchema = z.object({
  sus: z.array(z.number().nullable()),
  susScore: z.number().nullable(),
  open: z.object({
    like: z.string().optional(),
    dislike: z.string().optional(),
    missing: z.string().optional(),
    recommend: z.string().optional(),
  }),
  changes: z.array(
    z.object({
      key: z.string(),
      from: z.union([z.string(), z.number()]),
      to: z.union([z.string(), z.number()]),
      at: z.number(),
    }),
  ),
  finishedAt: z.number().nullable(),
});

const stateSchema = z.object({
  rounds: z.array(z.object({ number: z.number().int().positive(), tasks: taskSetSchema })).min(1),
  sessions: z.array(
    z.object({
      id: z.string(),
      round: z.number().int().positive(),
      participant: z.string(),
      startedAt: z.number(),
      consentAt: z.number().optional(),
      tasks: z.array(taskRecordSchema).optional(),
      final: finalSchema.optional(),
      blocks: z.array(z.object({ taskId: z.string(), at: z.number(), to: z.string() })).default([]),
      results: z.array(
        z.object({
          taskId: z.string(),
          startedAt: z.number(),
          endedAt: z.number(),
          outcome: z.enum(["done", "gave-up", "skipped"]),
          auto: z.boolean().optional(),
        }),
      ),
    }),
  ),
});

export function parseState(raw: string | null): StudyState {
  if (raw === null) return initialState();
  try {
    const parsed = stateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : initialState();
  } catch {
    return initialState();
  }
}
