import { type StudySession, sessionSchema, type TaskRecord } from "./study-model.ts";

export type ServerSession = {
  key: string;
  participant: string;
  round: number;
  dryRun: boolean;
  session: StudySession | undefined;
  traceParts: number;
  updatedAt: string;
};

export type ServerRow = {
  session_key: string;
  participant: string;
  round: number;
  dry_run: boolean;
  answers: Record<string, unknown>;
  trace_parts: number;
  updated_at: string;
};

export function fromServer(row: ServerRow): ServerSession {
  const parsed = sessionSchema.safeParse(row.answers);
  return {
    key: row.session_key,
    participant: row.participant,
    round: row.round,
    dryRun: row.dry_run,
    session: parsed.success ? parsed.data : undefined,
    traceParts: row.trace_parts,
    updatedAt: row.updated_at,
  };
}

export const counted = (sessions: readonly ServerSession[]): ServerSession[] =>
  sessions.filter((entry) => !entry.dryRun);

export type Attempt = { participant: string; sessionKey: string; round: number; task: TaskRecord };

export const attemptsOf = (sessions: readonly ServerSession[]): Attempt[] =>
  counted(sessions).flatMap((entry) =>
    (entry.session?.tasks ?? []).map((task) => ({
      participant: entry.participant,
      sessionKey: entry.key,
      round: entry.round,
      task,
    })),
  );

const present = <Value>(values: readonly (Value | null | undefined)[]): Value[] =>
  values.filter((value): value is Value => value !== null && value !== undefined);

export const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export type MetricRow = {
  key: string;
  label: string;
  attempts: number;
  successes: number;
  medianDurationMs: number | null;
  meanClicks: number | null;
  deadClicks: number;
  silentControlClicks: number;
  clicks: number;
  meanSeq: number | null;
  firstClickCorrect: number;
  firstClickJudged: number;
  medianTimeToFirstActionMs: number | null;
  medianTimeToFirstInputMs: number | null;
  meanPathStraightness: number | null;
};

function metricRow(key: string, label: string, tasks: readonly TaskRecord[]): MetricRow {
  const judged = present(tasks.map((task) => task.firstClickCorrect));
  return {
    key,
    label,
    attempts: tasks.length,
    successes: tasks.filter((task) => task.success).length,
    medianDurationMs: median(tasks.map((task) => task.durationMs)),
    meanClicks: mean(tasks.map((task) => task.clicks)),
    deadClicks: tasks.reduce((sum, task) => sum + task.deadClicks, 0),
    silentControlClicks: tasks.reduce((sum, task) => sum + (task.silentControlClicks ?? 0), 0),
    clicks: tasks.reduce((sum, task) => sum + task.clicks, 0),
    meanSeq: mean(present(tasks.map((task) => task.seq))),
    firstClickCorrect: judged.filter(Boolean).length,
    firstClickJudged: judged.length,
    medianTimeToFirstActionMs: median(present(tasks.map((task) => task.timeToFirstActionMs))),
    medianTimeToFirstInputMs: median(present(tasks.map((task) => task.timeToFirstInputMs))),
    meanPathStraightness: mean(present(tasks.map((task) => task.pathStraightness))),
  };
}

export function taskTable(sessions: readonly ServerSession[]): MetricRow[] {
  const attempts = attemptsOf(sessions);
  const order: { id: string; title: string }[] = [];
  for (const { task } of attempts) {
    if (!order.some((known) => known.id === task.id))
      order.push({ id: task.id, title: task.title });
  }
  return order.map(({ id, title }) =>
    metricRow(
      id,
      title,
      attempts.filter((attempt) => attempt.task.id === id).map((attempt) => attempt.task),
    ),
  );
}

export type ParticipantRow = MetricRow & { sus: number | null };

export const participantTable = (sessions: readonly ServerSession[]): ParticipantRow[] =>
  counted(sessions).map((entry) => ({
    ...metricRow(entry.key, entry.participant, entry.session?.tasks ?? []),
    sus: entry.session?.final?.susScore ?? null,
  }));

export type SusSummary = { rows: { participant: string; score: number }[]; mean: number | null };

export function susSummary(sessions: readonly ServerSession[]): SusSummary {
  const rows = counted(sessions).flatMap((entry) => {
    const score = entry.session?.final?.susScore;
    return score === null || score === undefined ? [] : [{ participant: entry.participant, score }];
  });
  return { rows, mean: mean(rows.map((row) => row.score)) };
}

export type Note = { participant: string; text: string };

export type TaskNotesGroup = {
  taskId: string;
  title: string;
  like: Note[];
  dislike: Note[];
  recommend: Note[];
};

const written = (text: string | undefined): text is string =>
  text !== undefined && text.trim() !== "";

export function notesByTask(sessions: readonly ServerSession[]): TaskNotesGroup[] {
  return taskTable(sessions).map((row) => {
    const attempts = attemptsOf(sessions).filter((attempt) => attempt.task.id === row.key);
    const notes = (key: "like" | "dislike" | "recommend"): Note[] =>
      attempts.flatMap((attempt) => {
        const text = attempt.task.notes[key];
        return written(text) ? [{ participant: attempt.participant, text }] : [];
      });
    return {
      taskId: row.key,
      title: row.label,
      like: notes("like"),
      dislike: notes("dislike"),
      recommend: notes("recommend"),
    };
  });
}

export type FinalOpen = {
  participant: string;
  like: string;
  dislike: string;
  missing: string;
  recommend: string;
};

export const finalAnswers = (sessions: readonly ServerSession[]): FinalOpen[] =>
  counted(sessions).flatMap((entry) => {
    const open = entry.session?.final?.open;
    if (open === undefined) return [];
    const row = {
      participant: entry.participant,
      like: open.like ?? "",
      dislike: open.dislike ?? "",
      missing: open.missing ?? "",
      recommend: open.recommend ?? "",
    };
    return [row.like, row.dislike, row.missing, row.recommend].some(written) ? [row] : [];
  });

export type RoundFigures = {
  tasksCompleted: number;
  tasksAttempted: number;
  meanSeq: number | null;
  seqRated: number;
  seqSixOrSeven: number;
  seqBelowFour: number;
  meanSus: number | null;
  susByParticipant: { participant: string; score: number }[];
  deadClicks: number;
  silentControlClicks: number;
  clicks: number;
  medianTimeToFirstActionMs: number | null;
  medianTimeToFirstInputMs: number | null;
};

export function thisRound(sessions: readonly ServerSession[]): RoundFigures {
  const tasks = attemptsOf(sessions).map((attempt) => attempt.task);
  const seqs = present(tasks.map((task) => task.seq));
  const sus = susSummary(sessions);
  return {
    tasksCompleted: tasks.filter((task) => task.success).length,
    tasksAttempted: tasks.length,
    meanSeq: mean(seqs),
    seqRated: seqs.length,
    seqSixOrSeven: seqs.filter((seq) => seq >= 6).length,
    seqBelowFour: seqs.filter((seq) => seq < 4).length,
    meanSus: sus.mean,
    susByParticipant: sus.rows,
    deadClicks: tasks.reduce((sum, task) => sum + task.deadClicks, 0),
    silentControlClicks: tasks.reduce((sum, task) => sum + (task.silentControlClicks ?? 0), 0),
    clicks: tasks.reduce((sum, task) => sum + task.clicks, 0),
    medianTimeToFirstActionMs: median(present(tasks.map((task) => task.timeToFirstActionMs))),
    medianTimeToFirstInputMs: median(present(tasks.map((task) => task.timeToFirstInputMs))),
  };
}

export const csvColumns = [
  "participant",
  "session",
  "round",
  "task",
  "idx",
  "title",
  "success",
  "durationMs",
  "clicks",
  "deadClicks",
  "silentControlClicks",
  "blocked",
  "keys",
  "wheels",
  "seq",
  "firstClickCorrect",
  "timeToFirstActionMs",
  "timeToFirstInputMs",
  "pathStraightness",
  "reason",
  "like",
  "dislike",
  "recommend",
] as const;

const csvCell = (value: string | number | boolean | null | undefined): string => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function attemptsCsv(sessions: readonly ServerSession[]): string {
  const rows = attemptsOf(sessions).map(({ participant, sessionKey, round, task }) =>
    [
      participant,
      sessionKey,
      round,
      task.id,
      task.idx,
      task.title,
      task.success,
      task.durationMs,
      task.clicks,
      task.deadClicks,
      task.silentControlClicks,
      task.blocked,
      task.keys,
      task.wheels,
      task.seq,
      task.firstClickCorrect,
      task.timeToFirstActionMs,
      task.timeToFirstInputMs,
      task.pathStraightness,
      task.reason,
      task.notes.like,
      task.notes.dislike,
      task.notes.recommend,
    ]
      .map(csvCell)
      .join(","),
  );
  return `${[csvColumns.join(","), ...rows].join("\n")}\n`;
}

export const resultsJson = (sessions: readonly ServerSession[]): string =>
  JSON.stringify(
    {
      sessions: counted(sessions).map((entry) => ({
        key: entry.key,
        participant: entry.participant,
        round: entry.round,
        answers: entry.session,
      })),
      dryRuns: sessions.filter((entry) => entry.dryRun).map((entry) => entry.key),
    },
    null,
    2,
  );
