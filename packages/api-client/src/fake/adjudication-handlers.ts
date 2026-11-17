import { HttpResponse, http, type RequestHandler } from "msw";
import { type EvaluationReport, evaluationReportSchema } from "../draft/evaluation-report.ts";
import {
  getGetDisagreementQueueMockHandler,
  getGetMyAdjudicationMockHandler,
  getGetSignOffSummaryMockHandler,
  getGetTaskEvaluationMockHandler,
  getListEvaluationChangesMockHandler,
  getListMyAdjudicationsMockHandler,
  getSendToAdjudicatorMockHandler,
  getSignOffReviewTaskMockHandler,
  getStartEvaluationVersionMockHandler,
} from "../generated/api.msw.ts";
import type {
  AdjudicationAnswer,
  AdjudicationDraft,
  AdjudicationObject,
  DisagreementQueue,
  Evaluation,
  EvaluationChange,
  EvaluationChanges,
  MyAdjudication,
  MyAdjudicationTask,
  QueuedObject,
  QueuedObjectUpdate,
  QueueRow,
  SignOffSummary,
} from "../generated/api.ts";
import { answersFor, countedFromAnswers, decisionSettingsFor } from "./decision-settings.ts";
import { taskDisplayFor } from "./display-settings.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import {
  fakeQueueScene,
  type LiveRow,
  liveRow,
  queueState,
  queueTaskView,
  reviewsAreIn,
  signTask,
  startNextVersion,
} from "./queue-scene.ts";
import { savedNoteOf } from "./review-decisions.ts";
import { toThreads } from "./review-handlers.ts";
import {
  adjudications,
  type PersonKey,
  people,
  projectByCode,
  reviewTasks,
  type ScenarioReviewTask,
  scenarioNow,
  signedInAs,
  slideByIndex,
  slides,
} from "./scenario.ts";
import {
  adjudicator,
  changesAfterSignOff,
  comparisonNumbers,
  comparisonTask,
  confusion,
  editedRow,
  evaluationNumbers,
  lockedBy,
  opinionCounts,
  opinionQuestion,
  type QueueSeedRow,
  queueKey,
  queueRows,
  queueTask,
  queueTotalObjects,
  reasonCounts,
  reportFormats,
  reportTemplate,
  researcher,
  resultSetFacts,
  reviewerA,
  reviewerB,
  signature,
  worstObjects,
} from "./scenario-adjudication.ts";
import { rt13, rt18 } from "./scenario-review.ts";
import { studyTemplates } from "./scenario-task.ts";
import { fakeView } from "./view.ts";
import { toTaskStates } from "./work-handlers.ts";
import { inScenarioWorkspace } from "./workspace-scene.ts";

const task = () => {
  const found = reviewTasks.find((candidate) => candidate.code === queueTask);
  if (found === undefined) throw new Error(`no scenario task ${queueTask}`);
  return found;
};

const comparisonId = () =>
  reviewTasks.find((candidate) => candidate.code === comparisonTask.code)?.id;

const idOf = (key: PersonKey) => people[key].id;

const tagOf = (seed: QueueSeedRow): QueueRow["tag"] => {
  const [a, b] = seed.answers;
  if (seed.answers.some((item) => item.reason === "Need a second look")) return "second";
  if (a.raw !== b.raw) return "differ";
  return "bothai";
};

const toQueueRow = (seed: QueueSeedRow): QueueRow => {
  const key = queueKey(seed);
  const live = liveRow(key);
  const decision = live.adjudicated
    ? {
        raw: live.adjudicated.raw,
        note: live.adjudicated.note ?? null,
        by_user_id: idOf(adjudicator),
        at: live.adjudicated.at,
      }
    : live.decision
      ? {
          raw: live.decision.raw,
          note: live.decision.note,
          by_user_id: idOf(live.decision.by),
          at: live.decision.at,
        }
      : null;
  return {
    key,
    slide_id: slideByIndex(seed.slide).id,
    slide_label: seed.slideLabel,
    object: seed.object,
    kind: seed.kind,
    ai: { class_name: seed.className, score: seed.score },
    size_mm: seed.sizeMm,
    tag: tagOf(seed),
    answers: seed.answers.map((item) => ({
      user_id: idOf(item.by),
      raw: item.raw,
      reason: item.reason,
      note: noteOf(seed, item.by, item.note),
    })),
    state: live.state,
    decision,
    adjudicator: live.adjudicator
      ? { user_id: idOf(live.adjudicator.by), note: live.adjudicator.note }
      : null,
    edited: live.edited ? { by_user_id: idOf(editedRow.by), on: editedRow.on } : null,
  };
};

export const toDisagreementQueue = (taskId: string): DisagreementQueue => ({
  task_id: taskId,
  total_objects: queueTotalObjects,
  locked: reviewsAreIn() ? null : { user_id: idOf(lockedBy.by), slides_left: lockedBy.slidesLeft },
  rows: queueRows.map(toQueueRow),
});

const seedOf = (slideId: string, object: string) =>
  queueRows.find((seed) => slideByIndex(seed.slide).id === slideId && seed.object === object);

const noteOf = (seed: QueueSeedRow, who: PersonKey, seeded: string | null) =>
  who === signedInAs
    ? (savedNoteOf(task().id, slideByIndex(seed.slide).id, seed.object) ?? seeded)
    : seeded;

const answerOf = (seed: QueueSeedRow, who: PersonKey) => {
  const found = seed.answers.find((item) => item.by === who) ?? seed.answers[0];
  return { raw: found.raw, reason: found.reason, note: noteOf(seed, found.by, found.note) };
};

const forAdjudicator = (live: LiveRow) =>
  live.adjudicator?.by === adjudicator &&
  (live.state === "with-adjudicator" || live.state === "adjudicated");

const sentNote = () =>
  queueRows
    .map((seed) => liveRow(queueKey(seed)))
    .find((live) => forAdjudicator(live) && live.adjudicator?.note)?.adjudicator?.note ?? null;

const toAdjudicationObject = (seed: QueueSeedRow): AdjudicationObject => {
  const live = liveRow(queueKey(seed));
  return {
    key: queueKey(seed),
    slide_id: slideByIndex(seed.slide).id,
    slide_label: seed.slideLabel,
    object: seed.object,
    kind: seed.kind,
    ai: { class_name: seed.className, score: seed.score },
    size_mm: seed.sizeMm,
    reviewer_a: answerOf(seed, reviewerA),
    reviewer_b: answerOf(seed, reviewerB),
    decision: live.adjudicated?.raw ?? null,
    decision_note: live.adjudicated?.note ?? null,
  };
};

export const toMyAdjudication = (taskId: string): MyAdjudicationTask => ({
  task_id: taskId,
  asked_by_user_id: idOf(researcher),
  note: sentNote(),
  objects: queueRows
    .filter((seed) => forAdjudicator(liveRow(queueKey(seed))))
    .map(toAdjudicationObject),
});

const counted = (keys: PersonKey[]) =>
  [...new Set(keys)].map((key) => ({
    user_id: idOf(key),
    count: keys.filter((item) => item === key).length,
  }));

const otherTask = (taskId: string) =>
  [...reviewTasks, rt18].find(
    (candidate) => candidate.id === taskId && candidate.code !== queueTask,
  );

const ownSignOffSummary = (current: ScenarioReviewTask): SignOffSummary => {
  const view = queueTaskView(current);
  const total = view.slides * view.reviewers.length;
  const submitted = view.reviewers.reduce((sum, key) => sum + (view.progress[key] ?? 0), 0);
  const signed = view.status === "signed";
  return {
    task_id: view.id,
    version: 1,
    reviewer_ids: view.reviewers.map(idOf),
    reviews: {
      slides: view.slides,
      submitted,
      total,
      opinion_forms: submitted,
      behind: view.reviewers
        .map((key) => ({
          user_id: idOf(key),
          slides_left: view.slides - (view.progress[key] ?? 0),
        }))
        .filter((row) => row.slides_left > 0),
    },
    queue: {
      total: 0,
      resolved: 0,
      by_researcher: 0,
      by_adjudicator: [],
      with_adjudicator: [],
      left_open: [],
    },
    open_threads: { total: 0, slides: [] },
    result_set: resultSetFacts,
    signature: signed
      ? { by_user_id: idOf(signature.by), at: signature.at, checksum: signature.checksum }
      : null,
    changes: [],
    next_version: null,
  };
};

export const toSignOffSummary = (taskId: string): SignOffSummary => {
  const own = otherTask(taskId);
  if (own !== undefined) return ownSignOffSummary(own);
  const current = task();
  const state = queueState();
  const live = queueRows.map((seed) => ({ seed, live: liveRow(queueKey(seed)) }));
  const total = current.slides * current.reviewers.length;
  const inAll = reviewsAreIn();
  const submitted = inAll
    ? total
    : current.reviewers.reduce((sum, key) => sum + (current.progress[key] ?? 0), 0);
  const behind = inAll
    ? []
    : current.reviewers
        .map((key) => ({
          user_id: idOf(key),
          slides_left: current.slides - (current.progress[key] ?? 0),
        }))
        .filter((row) => row.slides_left > 0);
  const states = live.map((item) => item.live.state);
  const openThreads = slides
    .map((slide) => ({
      slide_label: slide.label,
      count: toThreads(current.id, slide.id, false).length,
    }))
    .filter((row) => row.count > 0);
  return {
    task_id: taskId,
    version: 1,
    reviewer_ids: current.reviewers.map(idOf),
    reviews: { slides: current.slides, submitted, total, opinion_forms: submitted, behind },
    queue: {
      total: live.length,
      resolved: states.filter((value) => ["decided", "left-open", "adjudicated"].includes(value))
        .length,
      by_researcher: states.filter((value) => value === "decided").length,
      by_adjudicator: counted(
        live.flatMap((item) => (item.live.state === "adjudicated" ? [adjudicator] : [])),
      ),
      with_adjudicator: counted(
        live.flatMap((item) =>
          item.live.state === "with-adjudicator" && item.live.adjudicator
            ? [item.live.adjudicator.by]
            : [],
        ),
      ),
      left_open: live
        .filter((item) => item.live.state === "left-open")
        .map((item) => ({ object: item.seed.object, slide_label: item.seed.slideLabel })),
    },
    open_threads: {
      total: openThreads.reduce((sum, row) => sum + row.count, 0),
      slides: openThreads,
    },
    result_set: resultSetFacts,
    signature: state.signed
      ? { by_user_id: idOf(signature.by), at: signature.at, checksum: signature.checksum }
      : null,
    changes: loggedChanges(state.signed),
    next_version: state.nextVersion
      ? {
          version: 2,
          reason: state.nextVersion.reason,
          by_user_id: idOf(researcher),
          started_at: state.nextVersion.at,
        }
      : null,
  };
};

const decisionsOf = (taskId: string): Evaluation["decisions"] => {
  const code = [...reviewTasks, rt13].find((candidate) => candidate.id === taskId)?.code ?? "";
  const answers = answersFor(code);
  if (answers === null) {
    return {
      style: "agree",
      counts_as: ["disagree", "disagree", "unsure", "agree", "agree"],
      counted: { agree: 0, disagree: 0, unsure: 2 },
      answers: { unsure: 2 },
    };
  }
  const settings = decisionSettingsFor(code);
  return {
    style: settings.style,
    counts_as: settings.counts_as,
    counted: countedFromAnswers(answers, settings.counts_as),
    answers,
  };
};

export const toTaskEvaluation = (taskId: string): Evaluation => {
  const numbers = taskId === comparisonId() ? comparisonNumbers : evaluationNumbers;
  const tumor = {
    kind: "region",
    class_name: "Tumor",
    true_positives: numbers.sensitivity.numerator,
    false_positives: numbers.precision.denominator - numbers.precision.numerator,
    false_negatives: numbers.sensitivity.denominator - numbers.sensitivity.numerator,
    unsure: 2,
    undecided: 0,
    precision: numbers.precision,
    sensitivity: numbers.sensitivity,
  };
  const total = Object.values(opinionCounts).reduce((sum, value) => sum + value, 0);
  const mean =
    Object.entries(opinionCounts).reduce((sum, [score, count]) => sum + Number(score) * count, 0) /
    Math.max(total, 1);
  return {
    task_id: taskId,
    sample: false,
    decisions: decisionsOf(taskId),
    display: taskDisplayFor(task().code),
    presets: [],
    classes: [tumor],
    overall: [tumor],
    dice: { Tumor: numbers.dice },
    kappa: [
      { first: idOf(reviewerB), second: idOf(reviewerA), value: numbers.kappa, objects: 660 },
    ],
    mean_kappa: numbers.kappa,
    fleiss_kappa: null,
    cell_agreement_with_ai: numbers.cellsAgreed,
    cell_agreement_between_reviewers: numbers.cellsBetweenReviewers,
    reasons: reasonCounts,
    opinions: [
      {
        key: opinionQuestion.key,
        count: total,
        mean: Math.round(mean * 100) / 100,
        spread: null,
        counts: opinionCounts,
        texts: [],
      },
    ],
  };
};

const loggedChanges = (signed: boolean): EvaluationChange[] =>
  signed
    ? changesAfterSignOff.map((change) => ({
        version: 1,
        by_user_id: idOf(change.by),
        at: change.at,
        object: change.object,
        slide_label: change.slideLabel,
        text: change.text,
        reason: change.reason,
      }))
    : [];

export const toEvaluationChanges = (taskId: string): EvaluationChanges => ({
  task_id: taskId,
  signed_version: queueState().signed ? 1 : null,
  checksum: queueState().signed ? signature.checksum : null,
  changes: loggedChanges(queueState().signed),
});

export const toEvaluationReport = (taskId: string): EvaluationReport => {
  const current = task();
  const project = projectByCode(current.project);
  const template = studyTemplates.find((item) => item.key === "sn");
  const other = taskId === comparisonId();
  return evaluationReportSchema.parse({
    task_id: taskId,
    task_code: other ? comparisonTask.code : current.code,
    round_name: other ? "Round 1" : "Round 2",
    model: other ? comparisonTask.model : "CAMELYON tumor model v1.0",
    project: { id: project.id, code: project.code, name: project.name },
    lab: { name: "Fakultní nemocnice Vltava", short: "FV" },
    slides: current.slides,
    objects: queueTotalObjects,
    reviewer_ids: current.reviewers.map(idOf),
    adjudicators: 1,
    version: 1,
    signed_at: queueState().signed ? signature.at : null,
    signed_by_user_id: queueState().signed ? idOf(signature.by) : null,
    template: {
      id: template?.id ?? "sentinel-node",
      name: reportTemplate.name,
      version: reportTemplate.version,
      latest_version: reportTemplate.latestVersion,
      retired_on: fakeQueueScene().retired ? reportTemplate.retiredOn : null,
      blocks: reportTemplate.blocks,
    },
    formats: reportFormats,
    confusion,
    worst: worstObjects.map((row) => ({
      object: row.object,
      what: row.what,
      answers: row.answers.map((raw, index) => ({
        user_id: idOf(current.reviewers[index] ?? reviewerB),
        raw,
      })),
    })),
    opinion_question: opinionQuestion.text,
    changes: loggedChanges(queueState().signed),
  });
};

const taskPath = "*/api/review-tasks/:taskId";

const sendToAdjudicatorInScene = async (request: Request): Promise<QueuedObject[]> => {
  const body = (await request.json()) as AdjudicationDraft;
  const who =
    Object.values(people).find((person) => person.id === body.adjudicator_user_id)?.key ??
    adjudicator;
  for (const item of body.objects) {
    const seed = seedOf(item.slide_id, item.object);
    if (seed === undefined) continue;
    Object.assign(liveRow(queueKey(seed)), {
      state: "with-adjudicator",
      adjudicator: { by: who, note: body.note },
      decision: null,
    });
  }
  return [];
};

const toMyAdjudications = (): MyAdjudication[] =>
  adjudications
    .filter((item) => inScenarioWorkspace() && item.adjudicator === fakeView().viewer)
    .map((item) => {
      const task = reviewTasks.find((candidate) => candidate.code === item.task);
      if (task === undefined) throw new Error(`no scenario task ${item.task}`);
      const project = projectByCode(task.project);
      const slide = slideByIndex(item.slide);
      return {
        id: item.id,
        task_id: task.id,
        task_code: task.code,
        task_name: task.name,
        project: { id: project.id, code: project.code, name: project.name },
        asked_by_user_id: people[item.askedBy].id,
        slide_id: slide.id,
        slide_label: slide.label,
        objects: item.objects,
        decided: item.decided,
        sent_at: item.sentAt,
      };
    });

export const getGetEvaluationReportMockHandler = (overrideResponse?: EvaluationReport) =>
  http.get<{ taskId: string }>(`${taskPath}/evaluation-report`, ({ params }) =>
    HttpResponse.json(overrideResponse ?? toEvaluationReport(params.taskId)),
  );

const taskApi = "/api/review-tasks/{task_id}";

export const adjudicationDraftOperations: DraftOperation[] = [
  {
    operationId: "getEvaluationReport",
    method: "get",
    path: `${taskApi}/evaluation-report`,
    handler: () => getGetEvaluationReportMockHandler(),
  },
];

type ObjectParams = { taskId: string; slideId: string; objectId: string };

const objectOf = (params: ObjectParams) =>
  seedOf(params.slideId, decodeURIComponent(params.objectId));

const notQueued = () => HttpResponse.json({ status: 404 }, { status: 404 });

const updateQueuedObjectInScene = () =>
  http.post<ObjectParams>(
    `${taskPath}/disagreement-queue/:slideId/:objectId`,
    async ({ params, request }) => {
      const seed = objectOf(params);
      if (seed === undefined) return notQueued();
      const body = (await request.json()) as QueuedObjectUpdate;
      const live = liveRow(queueKey(seed));
      if (body.action === "decide" && body.raw) {
        Object.assign(live, {
          state: "decided",
          decision: { raw: body.raw, note: body.note ?? null, by: researcher, at: scenarioNow },
        });
      }
      if (body.action === "leave-open") Object.assign(live, { state: "left-open", decision: null });
      if (body.action === "look-again") Object.assign(live, { state: "look-again", edited: false });
      if (body.action === "keep-decisions") live.edited = false;
      return HttpResponse.json<QueueRow>(toQueueRow(seed));
    },
  );

const decideAdjudicationInScene = () =>
  http.post<ObjectParams>(
    `${taskPath}/adjudication/:slideId/:objectId`,
    async ({ params, request }) => {
      const seed = objectOf(params);
      if (seed === undefined) return notQueued();
      const body = (await request.json()) as AdjudicationAnswer;
      Object.assign(liveRow(queueKey(seed)), {
        state: "adjudicated",
        adjudicated: { raw: body.raw, at: scenarioNow, note: body.note?.trim() || null },
      });
      return HttpResponse.json<AdjudicationObject>(toAdjudicationObject(seed));
    },
  );

export function adjudicationHandlers(): RequestHandler[] {
  return [
    getGetDisagreementQueueMockHandler(({ params }) => toDisagreementQueue(String(params.taskId))),
    updateQueuedObjectInScene(),
    getGetMyAdjudicationMockHandler(({ params }) => toMyAdjudication(String(params.taskId))),
    decideAdjudicationInScene(),
    getSendToAdjudicatorMockHandler(({ request }) => sendToAdjudicatorInScene(request)),
    getListMyAdjudicationsMockHandler(() => toMyAdjudications()),
    getGetTaskEvaluationMockHandler(({ params }) => toTaskEvaluation(String(params.taskId))),
    getGetSignOffSummaryMockHandler(({ params }) => toSignOffSummary(String(params.taskId))),
    getListEvaluationChangesMockHandler(({ params }) => toEvaluationChanges(String(params.taskId))),
    getStartEvaluationVersionMockHandler(async ({ request }) => {
      const body = (await request.json()) as { reason: string };
      startNextVersion(body.reason, scenarioNow);
      return {
        version: 2,
        reason: body.reason,
        by_user_id: idOf(researcher),
        started_at: scenarioNow,
      };
    }),
    getSignOffReviewTaskMockHandler(({ params }) => {
      const signing = otherTask(String(params.taskId)) ?? task();
      signTask(signing);
      return toTaskStates(signing);
    }),
  ];
}
