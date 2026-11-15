import { z } from "zod";

export const studyTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  instruction: z.string().min(1),
  startPath: z.string().startsWith("/").optional(),
  targetSeconds: z.number().int().positive().optional(),
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
};

export type StudySession = {
  id: string;
  round: number;
  participant: string;
  startedAt: number;
  results: TaskResult[];
};

export type Round = { number: number; tasks: StudyTask[] };

export type StudyState = { rounds: Round[]; sessions: StudySession[] };

export const defaultTasks: StudyTask[] = [
  {
    id: "t1",
    title: "Open the slide",
    instruction: "Open the tumor_009 slide from the worklist.",
    startPath: "/",
    targetSeconds: 30,
  },
  {
    id: "t2",
    title: "Find the tumor",
    instruction: "Move the slide to the area you think holds tumor and zoom in on it.",
    targetSeconds: 60,
  },
  {
    id: "t3",
    title: "Read the AI result",
    instruction: "Say in your own words what the coloured overlay shows.",
    targetSeconds: 45,
  },
  {
    id: "t4",
    title: "Open the least sure zone",
    instruction: "Open the zone where the AI is least sure.",
    targetSeconds: 45,
  },
  {
    id: "t5",
    title: "Answer four unsure cells",
    instruction: "Mark four cells as unsure and give a reason for each.",
    targetSeconds: 120,
  },
  {
    id: "t6",
    title: "Change a lymphocyte",
    instruction: "Find a cell you can see is a lymphocyte and change the AI label to match.",
    targetSeconds: 60,
  },
  {
    id: "t7",
    title: "Compare two results",
    instruction: "Put two AI results side by side and tell which one you trust more.",
    targetSeconds: 90,
  },
  {
    id: "t8",
    title: "Leave a comment",
    instruction: "Leave a comment on a region and mention a colleague.",
    targetSeconds: 60,
  },
  {
    id: "t9",
    title: "Finish the slide",
    instruction: "Submit your review of this slide.",
    targetSeconds: 45,
  },
  {
    id: "t10",
    title: "Find the report",
    instruction: "Find the report and say what it counts.",
    targetSeconds: 60,
  },
];

export const initialState = (): StudyState => ({
  rounds: [{ number: 1, tasks: defaultTasks }],
  sessions: [],
});

export const currentRound = (state: StudyState): Round => {
  const last = state.rounds[state.rounds.length - 1];
  if (last === undefined) throw new Error("A study always has a round");
  return last;
};

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

export const nextTask = (round: Round, session: StudySession): StudyTask | undefined =>
  round.tasks.find((task) => !session.results.some((result) => result.taskId === task.id));

export const durationSeconds = (result: TaskResult): number =>
  Math.max(0, Math.round((result.endedAt - result.startedAt) / 1000));

export type TaskSummary = {
  taskId: string;
  sessions: number;
  completed: number;
  medianSeconds: number | undefined;
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
    };
  });
}

const stateSchema = z.object({
  rounds: z.array(z.object({ number: z.number().int().positive(), tasks: taskSetSchema })).min(1),
  sessions: z.array(
    z.object({
      id: z.string(),
      round: z.number().int().positive(),
      participant: z.string(),
      startedAt: z.number(),
      results: z.array(
        z.object({
          taskId: z.string(),
          startedAt: z.number(),
          endedAt: z.number(),
          outcome: z.enum(["done", "gave-up", "skipped"]),
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
