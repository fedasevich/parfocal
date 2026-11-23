import assert from "node:assert/strict";
import { test } from "node:test";
import { roundFourReported } from "../src/study/round-four.ts";
import type { StudySession, TaskRecord } from "../src/study/study-model.ts";
import {
  attemptsCsv,
  counted,
  csvColumns,
  finalAnswers,
  fromServer,
  notesByTask,
  participantTable,
  resultsJson,
  type ServerSession,
  susSummary,
  taskTable,
  thisRound,
} from "../src/study/study-results.ts";
import {
  createUploader,
  gunzipBase64,
  gzipBase64,
  type UploadTransport,
  watchStudySessions,
} from "../src/study/study-upload.ts";
import { straightness } from "../src/study/task-metrics.ts";
import {
  cameraAt,
  sameCamera,
  type TraceBatch,
  type TraceEvent,
  viewBoxOf,
} from "../src/study/trace/trace-model.ts";

const task = (id: string, change: Partial<TaskRecord> = {}): TaskRecord => ({
  id,
  idx: 0,
  title: `Task ${id}`,
  goal: `Do ${id}`,
  success: true,
  durationMs: 10_000,
  clicks: 10,
  deadClicks: 1,
  blocked: 0,
  keys: 0,
  wheels: 0,
  seq: 6,
  notes: {},
  reason: null,
  endedAt: 1,
  timeToFirstActionMs: 4000,
  firstClickCorrect: null,
  pathStraightness: 0.5,
  ...change,
});

const session = (participant: string, tasks: TaskRecord[], sus: number | null): StudySession => ({
  id: `s-${participant}`,
  round: 1,
  participant,
  startedAt: 0,
  results: [],
  blocks: [],
  consentAt: 0,
  tasks,
  final: {
    sus: [],
    susScore: sus,
    open: { like: `${participant} liked it`, missing: 'a, "search"' },
    changes: [],
    finishedAt: 1,
  },
});

const server = (answers: StudySession, dryRun = false): ServerSession =>
  fromServer({
    session_key: answers.id,
    participant: answers.participant,
    round: answers.round,
    dry_run: dryRun,
    answers: { ...answers },
    trace_parts: 2,
    updated_at: "2026-11-23T10:00:00Z",
  });

const sessions = [
  server(
    session(
      "P-AAAA",
      [
        task("open", { notes: { like: "clear list" }, firstClickCorrect: true }),
        task("look", {
          success: false,
          seq: 3,
          reason: "where-to-look",
          clicks: 20,
          deadClicks: 4,
        }),
      ],
      80,
    ),
  ),
  server(
    session(
      "P-BBBB",
      [
        task("open", { firstClickCorrect: false, timeToFirstActionMs: 6000, seq: 7 }),
        task("look", { notes: { dislike: 'too slow, "really"' } }),
      ],
      90,
    ),
  ),
  server(session("P-DRY1", [task("open", { seq: 1 }), task("look", { seq: 1 })], 10), true),
];

test("a server row parses back into the stored session shape", () => {
  const [first] = sessions;
  assert.equal(first?.session?.tasks?.length, 2);
  assert.equal(first?.traceParts, 2);
  assert.equal(fromServer({ ...rowOf(first), answers: { nonsense: true } }).session, undefined);
});

function rowOf(entry: ServerSession | undefined) {
  return {
    session_key: entry?.key ?? "",
    participant: entry?.participant ?? "",
    round: entry?.round ?? 1,
    dry_run: entry?.dryRun ?? false,
    answers: {},
    trace_parts: 0,
    updated_at: "",
  };
}

test("dry runs are left out of every table, the SUS mean, the notes and the round figures", () => {
  assert.deepEqual(
    counted(sessions).map((entry) => entry.participant),
    ["P-AAAA", "P-BBBB"],
  );
  const tasks = taskTable(sessions);
  assert.deepEqual(
    tasks.map((row) => [row.key, row.attempts, row.successes, row.meanSeq]),
    [
      ["open", 2, 2, 6.5],
      ["look", 2, 1, 4.5],
    ],
  );
  assert.equal(tasks[0]?.firstClickCorrect, 1);
  assert.equal(tasks[0]?.firstClickJudged, 2);
  assert.equal(tasks[0]?.medianTimeToFirstActionMs, 5000);
  assert.equal(tasks[1]?.firstClickJudged, 0);
  assert.deepEqual(
    participantTable(sessions).map((row) => [row.label, row.sus, row.deadClicks, row.clicks]),
    [
      ["P-AAAA", 80, 5, 30],
      ["P-BBBB", 90, 2, 20],
    ],
  );
  assert.deepEqual(susSummary(sessions), {
    rows: [
      { participant: "P-AAAA", score: 80 },
      { participant: "P-BBBB", score: 90 },
    ],
    mean: 85,
  });
  assert.deepEqual(thisRound(sessions), {
    tasksCompleted: 3,
    tasksAttempted: 4,
    meanSeq: 5.5,
    seqRated: 4,
    seqSixOrSeven: 3,
    seqBelowFour: 1,
    meanSus: 85,
    susByParticipant: [
      { participant: "P-AAAA", score: 80 },
      { participant: "P-BBBB", score: 90 },
    ],
    deadClicks: 7,
    clicks: 50,
    medianTimeToFirstActionMs: 4000,
  });
  const exported = JSON.parse(resultsJson(sessions)) as { sessions: unknown[]; dryRuns: string[] };
  assert.equal(exported.sessions.length, 2);
  assert.deepEqual(exported.dryRuns, ["s-P-DRY1"]);
});

test("notes group by task and final open answers come per participant", () => {
  assert.deepEqual(notesByTask(sessions), [
    {
      taskId: "open",
      title: "Task open",
      like: [{ participant: "P-AAAA", text: "clear list" }],
      dislike: [],
      recommend: [],
    },
    {
      taskId: "look",
      title: "Task look",
      like: [],
      dislike: [{ participant: "P-BBBB", text: 'too slow, "really"' }],
      recommend: [],
    },
  ]);
  assert.deepEqual(
    finalAnswers(sessions).map((row) => [row.participant, row.like, row.missing]),
    [
      ["P-AAAA", "P-AAAA liked it", 'a, "search"'],
      ["P-BBBB", "P-BBBB liked it", 'a, "search"'],
    ],
  );
});

test("the CSV has one row per counted task attempt and quotes free text", () => {
  const lines = attemptsCsv(sessions).trimEnd().split("\n");
  assert.equal(lines[0], csvColumns.join(","));
  assert.equal(lines.length, 1 + 4);
  assert.ok(lines.every((line) => !line.includes("P-DRY1")));
  assert.ok(lines[4]?.endsWith(',"too slow, ""really""",'));
  assert.ok(lines[2]?.includes(",false,"));
  assert.ok(lines[2]?.includes(",where-to-look,"));
});

test("round 4 figures are the deck's numbers, quoted and never derived", () => {
  assert.deepEqual(roundFourReported, {
    tasksCompleted: 40,
    tasksAttempted: 40,
    meanSeq: 6.4,
    seqSixOrSeven: 35,
    seqRated: 40,
    seqBelowFour: 0,
    meanSus: 83.8,
    susByParticipant: [
      { participant: "P1", score: 100 },
      { participant: "P2", score: 95 },
      { participant: "P3", score: 80 },
      { participant: "P4", score: 60 },
    ],
    deadClickPercent: 15,
    deadClicks: 42,
    clicks: 277,
    medianTimeToFirstActionSeconds: 4.8,
    roundOneSus: 52.5,
  });
});

test("path straightness is the direct distance over the travelled one up to the first click", () => {
  assert.equal(straightness([]), null);
  assert.equal(straightness([{ x: 0, y: 0 }]), null);
  assert.equal(
    straightness([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]),
    1,
  );
  assert.equal(
    straightness([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 6, y: 0 },
    ]),
    0.6,
  );
});

const cameraEvent = (t: number, x: number, zoom: number): TraceEvent => ({
  t,
  k: "camera",
  slide: "slide-1",
  x,
  y: 500,
  zoom,
  w: 4000,
  h: 2000,
  vw: 800,
  vh: 400,
});

test("the replay camera is the last recorded one and a new page clears it", () => {
  const events: TraceEvent[] = [
    { t: 1000, k: "load", path: "/a", reload: false, w: 800, h: 600, head: [] },
    cameraEvent(1100, 1000, -2),
    cameraEvent(1500, 2000, 0),
    { t: 2000, k: "load", path: "/b", reload: false, w: 800, h: 600, head: [] },
  ];
  assert.equal(cameraAt(events, 50), undefined);
  assert.equal(cameraAt(events, 200)?.x, 1000);
  assert.equal(cameraAt(events, 600)?.x, 2000);
  assert.equal(cameraAt(events, 1000), undefined);
  const sample = cameraAt(events, 200);
  assert.ok(sample);
  assert.deepEqual(viewBoxOf(sample), { left: -600, top: -300, width: 3200, height: 1600 });
  assert.equal(sameCamera(sample, sample), true);
  assert.equal(sameCamera(undefined, sample), false);
  assert.equal(sameCamera(sample, { ...sample, zoom: -1 }), false);
});

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
};

test("gzip and base64 round trip the uploaded JSON", async () => {
  const value = { secret: "masked •••", list: [1, 2, 3] };
  const packed = await gzipBase64(value);
  assert.equal(atob(packed).charCodeAt(0), 0x1f);
  assert.deepEqual(await gunzipBase64(packed), value);
});

test("the outbox keeps sessions and trace parts until the server takes them, then retries", async () => {
  const sent: string[] = [];
  let online = false;
  const transport: UploadTransport = {
    session: (key) => {
      if (!online) return Promise.reject(new Error("offline"));
      sent.push(`session ${key}`);
      return Promise.resolve();
    },
    part: async (key, seq, body) => {
      if (!online) throw new Error("offline");
      sent.push(`part ${key} ${seq} ${JSON.stringify(await gunzipBase64(body.events_gz))}`);
    },
  };
  const answers = session("P-AAAA", [task("open")], 80);
  const batches: TraceBatch[] = [{ sessionId: answers.id, index: 7, events: [] }];
  const uploader = createUploader({
    transport,
    readSession: (id) => (id === answers.id ? answers : undefined),
    readBatch: (sessionId, index) =>
      Promise.resolve(
        batches.find((batch) => batch.sessionId === sessionId && batch.index === index),
      ),
    storage: memoryStorage(),
  });
  uploader.markSession(answers.id);
  uploader.queuePart(answers.id, 7);
  uploader.queuePart(answers.id, 7);
  assert.equal(uploader.pending(), 2);
  await uploader.flush();
  assert.equal(uploader.state(), "waiting");
  assert.equal(uploader.pending(), 2);
  online = true;
  await uploader.flush();
  assert.equal(uploader.state(), "synced");
  assert.equal(uploader.pending(), 0);
  assert.deepEqual(sent, [`session ${answers.id}`, `part ${answers.id} 7 []`]);
});

test("only participant sessions are watched, and only a changed one is sent again", () => {
  const marked: string[] = [];
  const uploader = {
    markSession: (id: string) => void marked.push(id),
    queuePart: () => undefined,
    flush: () => Promise.resolve(),
    state: () => "idle" as const,
    subscribe: () => () => undefined,
    pending: () => 0,
  };
  const participant = session("P-AAAA", [], null);
  const moderated: StudySession = { ...participant, id: "moderated", tasks: undefined };
  let current = [participant, moderated];
  let notify: () => void = () => undefined;
  watchStudySessions(
    uploader,
    () => current,
    (listener) => {
      notify = listener;
      return () => undefined;
    },
  );
  notify();
  current = [{ ...participant, tasks: [task("open")] }, moderated];
  notify();
  assert.deepEqual(marked, [participant.id, participant.id]);
});
