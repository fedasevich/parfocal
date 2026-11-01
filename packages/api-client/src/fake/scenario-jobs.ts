import {
  jobs as baseJobs,
  type PersonKey,
  type ProjectCode,
  type ScenarioJob,
  scenarioNow,
  slideByIndex,
} from "./scenario.ts";
import { taskSlides } from "./scenario-task.ts";

const uuid = (group: number, index: number) =>
  `00000000-0000-4000-8${String(group).padStart(3, "0")}-${String(index).padStart(12, "0")}`;

export type ModelKey = "cam" | "sam" | "hov" | "lab";

export type ScenarioModel = {
  key: ModelKey;
  id: string;
  name: string;
  version: string;
  title: string;
  description: string;
  makes: ("regions" | "cells" | "heatmap")[];
  minutesPerSlide: number;
  host: "parfocal" | "lab";
  server: string;
  runsAhead: number;
  queueMinutes: number;
  latencyMs: number | null;
};

const parfocalGpu = "Parfocal GPU";
export const labServer = "ml.cuailab.cz";

export const models: ScenarioModel[] = [
  {
    key: "cam",
    id: uuid(80, 1),
    name: "camelyon-tumor",
    version: "v1.0",
    title: "CAMELYON tumor model",
    description: "Tumor regions and a heatmap",
    makes: ["regions", "heatmap"],
    minutesPerSlide: 4,
    host: "parfocal",
    server: parfocalGpu,
    runsAhead: 1,
    queueMinutes: 8,
    latencyMs: null,
  },
  {
    key: "sam",
    id: uuid(80, 2),
    name: "pathosam-hovernext",
    version: "v1.2",
    title: "PathoSAM + HoVer-NeXt",
    description: "Tumor regions and every cell with a type",
    makes: ["regions", "cells"],
    minutesPerSlide: 17,
    host: "parfocal",
    server: parfocalGpu,
    runsAhead: 1,
    queueMinutes: 8,
    latencyMs: null,
  },
  {
    key: "hov",
    id: uuid(80, 3),
    name: "hovernet",
    version: "v0.9",
    title: "HoVer-Net",
    description: "Every cell with a type, no regions",
    makes: ["cells"],
    minutesPerSlide: 9,
    host: "parfocal",
    server: parfocalGpu,
    runsAhead: 1,
    queueMinutes: 8,
    latencyMs: null,
  },
  {
    key: "lab",
    id: uuid(80, 4),
    name: "lab-hovernet-fork",
    version: "v2.1",
    title: "Lab HoVer-Net fork",
    description: `Runs on your server, ${labServer}`,
    makes: ["cells"],
    minutesPerSlide: 6,
    host: "lab",
    server: labServer,
    runsAhead: 0,
    queueMinutes: 0,
    latencyMs: 210,
  },
];

export function modelByKey(key: ModelKey): ScenarioModel {
  const found = models.find((model) => model.key === key);
  if (found === undefined) throw new Error(`no scenario model ${key}`);
  return found;
}

export const runSteps = [
  "Queued",
  "Tiles read",
  "Tissue found",
  "Model running",
  "Objects placed",
  "IDs given",
  "Result set added",
] as const;

export type RunUnits = [done: number, total: number | null];

export type RunSlideSeed = {
  id: string;
  slideId: string;
  label: string;
  file: string;
  at: number;
  state: "waiting" | "running" | "paused" | "done";
  units: RunUnits[];
};

export type RunBatchSeed = {
  id: string;
  project: ProjectCode;
  model: ModelKey;
  by: PersonKey;
  createdAt: string;
  finishedAt: string | null;
  server: string;
  slides: RunSlideSeed[];
};

const taskSlide = (label: string, stain = "H&E") => {
  const found = taskSlides.find((item) => item.label === label && item.stain === stain);
  if (found === undefined) throw new Error(`no task slide ${label}`);
  return found;
};

export const defaultRunSlideIds = [taskSlide("tumor_052").id, taskSlide("tumor_060").id];

export const defaultRunModel: ModelKey = "sam";

export const startedRunId = uuid(8, 1);

const camSlide = slideByIndex(5);

export const pausedRun = {
  id: uuid(8, 2),
  pausedAt: "2026-10-15T14:18:00+02:00",
  resumedAt: [460, 1180] as RunUnits,
  movedMinutes: 4,
  resumedMinutes: 6,
};

export const finishedRunId = uuid(8, 3);

const lnSlides = [
  { label: "LN-0141", id: slideByIndex(13).id, area: 61, cells: 21408 },
  { label: "LN-0142", id: uuid(81, 2), area: 44, cells: 15330 },
  { label: "LN-0143", id: uuid(81, 3), area: 52, cells: 18902 },
  { label: "LN-0147", id: uuid(81, 7), area: 39, cells: 12775 },
];

export const runBatches: RunBatchSeed[] = [
  {
    id: pausedRun.id,
    project: "P07",
    model: "cam",
    by: "DH",
    createdAt: "2026-10-15T08:20:00+02:00",
    finishedAt: null,
    server: labServer,
    slides: [
      {
        id: uuid(82, 21),
        slideId: camSlide.id,
        label: camSlide.label,
        file: `${camSlide.label}.tif`,
        at: 3,
        state: "paused",
        units: [
          [0, null],
          [9, 9],
          [48, null],
          [448, 1180],
        ],
      },
    ],
  },
  {
    id: finishedRunId,
    project: "P09",
    model: "lab",
    by: "AK",
    createdAt: "2026-10-14T16:02:00+02:00",
    finishedAt: "2026-10-14T16:36:00+02:00",
    server: labServer,
    slides: lnSlides.map((slide, index) => ({
      id: uuid(82, 31 + index),
      slideId: slide.id,
      label: slide.label,
      file: `${slide.label}.svs`,
      at: runSteps.length,
      state: "done" as const,
      units: [
        [0, null],
        [9, 9],
        [slide.area, null],
        [1, 1],
        [slide.cells, slide.cells],
        [slide.cells, slide.cells],
        [1, 1],
      ] satisfies RunUnits[],
    })),
  },
];

export type ProjectSlideRef = { id: string; label: string; file: string };

export function startedBatch(slides: ProjectSlideRef[], model: ModelKey): RunBatchSeed {
  const chosen = modelByKey(model);
  return {
    id: startedRunId,
    project: "P07",
    model,
    by: "DH",
    createdAt: scenarioNow,
    finishedAt: null,
    server: chosen.server,
    slides: slides.map((slide, index) => ({
      id: uuid(82, 11 + index),
      slideId: slide.id,
      label: slide.label,
      file: slide.file,
      at: index === 0 ? 1 : 0,
      state: index === 0 ? "running" : "waiting",
      units:
        index === 0
          ? [
              [chosen.runsAhead, null],
              [1, 9],
            ]
          : [],
    })),
  };
}

export const defaultStartedSlides = (): ProjectSlideRef[] =>
  defaultRunSlideIds.map((id) => {
    const slide = taskSlides.find((item) => item.id === id);
    if (slide === undefined) throw new Error(`no task slide ${id}`);
    return { id, label: slide.label, file: `${slide.label}.tif` };
  });

export const toSlideRef = (id: string): ProjectSlideRef | undefined => {
  const slide = taskSlides.find((item) => item.id === id);
  if (slide === undefined) return undefined;
  const label = slide.caseLabel === null ? slide.label : `${slide.label} · ${slide.stain}`;
  const file =
    slide.caseLabel === null
      ? `${slide.label}.tif`
      : `${slide.caseLabel}_${slide.label}_${slide.stain.replace("&", "")}.svs`;
  return { id, label, file };
};

export type JobsState = {
  started: { slides: ProjectSlideRef[]; model: ModelKey } | null;
  resumed: "no" | "resumed" | "moved";
  cancelled: string[];
};

export const initialJobsState: JobsState = { started: null, resumed: "no", cancelled: [] };

const uploadIntoP07 = uuid(8, 4);

export function slidePercent(slide: RunSlideSeed): number {
  if (slide.state === "done") return 100;
  const current = slide.units[slide.at];
  const share = current?.[1] ? current[0] / current[1] : 0;
  return Math.round(((slide.at + share) / runSteps.length) * 100);
}

export function stepPercent(units: RunUnits | undefined): number {
  if (units === undefined || !units[1]) return 0;
  return Math.round((units[0] / units[1]) * 100);
}

export function batchesFor(state: JobsState): RunBatchSeed[] {
  const seeded = runBatches.map((batch) =>
    batch.id === pausedRun.id && state.resumed !== "no" ? resumedBatch(batch, state) : batch,
  );
  const started = state.started ? [startedBatch(state.started.slides, state.started.model)] : [];
  return [...started, ...seeded].filter((batch) => !state.cancelled.includes(batch.id));
}

function resumedBatch(batch: RunBatchSeed, state: JobsState): RunBatchSeed {
  return {
    ...batch,
    server: state.resumed === "moved" ? parfocalGpu : batch.server,
    slides: batch.slides.map((slide) => ({
      ...slide,
      state: "running",
      units: slide.units.map((units, index) => (index === slide.at ? pausedRun.resumedAt : units)),
    })),
  };
}

function batchTitle(batch: RunBatchSeed): string {
  const model = modelByKey(batch.model);
  return batch.id === finishedRunId ? "HoVer-Net v2.1" : `${model.title} ${model.version}`;
}

const andJoin = (labels: string[]) =>
  labels.length <= 1
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;

export type JobRow = ScenarioJob & {
  slides: ProjectSlideRef[];
  pause: { reason: "server-not-answering"; server: string; since: string } | null;
};

export function jobsFor(state: JobsState): JobRow[] {
  const batches = batchesFor(state);
  const batchOf = (id: string) => batches.find((batch) => batch.id === id);
  const rows: JobRow[] = [];
  const started = batchOf(startedRunId);
  if (started) {
    const model = modelByKey(started.model);
    rows.push({
      id: started.id,
      kind: "model-run",
      title: batchTitle(started),
      project: started.project,
      status: "running",
      unitsDone: 0,
      unitsTotal: started.slides.length,
      createdAt: started.createdAt,
      finishedAt: null,
      by: started.by,
      detail: `${andJoin(started.slides.map((slide) => slide.label))} in ${started.project}`,
      percent: 3,
      minutesLeft: model.minutesPerSlide * started.slides.length,
      slides: started.slides.map(({ slideId, label, file }) => ({ id: slideId, label, file })),
      pause: null,
    });
  }
  for (const job of baseJobs) {
    if (state.cancelled.includes(job.id)) continue;
    const batch = batchOf(job.id);
    const slides = (batch?.slides ?? []).map(({ slideId, label, file }) => ({
      id: slideId,
      label,
      file,
    }));
    if (job.id === uploadIntoP07 && started) {
      rows.push({
        ...job,
        status: "done",
        unitsDone: 6,
        detail: "6 slides and 4 result sets",
        percent: 100,
        minutesLeft: null,
        finishedAt: scenarioNow,
        slides,
        pause: null,
      });
      continue;
    }
    if (job.id === pausedRun.id && state.resumed !== "no") {
      const moved = state.resumed === "moved";
      rows.push({
        ...job,
        status: "running",
        percent: 39,
        minutesLeft: moved ? pausedRun.movedMinutes : pausedRun.resumedMinutes,
        slides,
        pause: null,
      });
      continue;
    }
    rows.push({
      ...job,
      slides,
      pause:
        job.status === "paused"
          ? { reason: "server-not-answering", server: labServer, since: pausedRun.pausedAt }
          : null,
    });
  }
  return rows;
}
