import { HttpResponse, http, type RequestHandler } from "msw";
import {
  type SharedAiObject,
  type SharedAiObjects,
  sharedAiObjectsSchema,
} from "../draft/list-shared-ai-objects.ts";
import type {
  AiObjectEdit,
  AnnotateSlideStatus,
  AnnotationDraft,
  AnnotationEdit,
  CheckDraft,
  CheckProgress,
  LayerObject,
  ProjectClass,
  SharedLayer,
} from "../generated/api.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import { people, resultSets } from "./scenario.ts";
import { annotateStubTaskId } from "./scenario-review.ts";
import { fakeView } from "./view.ts";

const storageKey = "parfocal.fake.shared-layer";

const uuid = (group: number, index: number) =>
  `00000000-0000-4000-8${String(group).padStart(3, "0")}-${String(index).padStart(12, "0")}`;

export const annotateTaskSlides = {
  withResults: uuid(5, 5),
  byHand: uuid(5, 14),
} as const;

export const annotateTaskClasses: ProjectClass[] = [
  { id: uuid(21, 1), key: 1, name: "Tumor cell", colour: "#f87171" },
  { id: uuid(21, 2), key: 2, name: "Lymphocyte", colour: "#c084fc" },
  { id: uuid(21, 3), key: 3, name: "Mitosis", colour: "#fbbf24" },
];

const resultSet = resultSets.find((set) => set.key === "sam") ?? resultSets[0];

const resultSetOf = (slideId: string) =>
  slideId === annotateTaskSlides.withResults ? (resultSet?.id ?? null) : null;

const square = (x: number, y: number, size: number): SharedAiObject["geometry"] => ({
  type: "Polygon",
  coordinates: [
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y],
    ],
  ],
});

const aiCells: SharedAiObject[] = [0.42, 0.61, 0.73, 0.88, 0.55, 0.94].map((score, index) => ({
  object: `C${index + 1}`,
  kind: "cell",
  number: index + 1,
  class_id: annotateTaskClasses[index % 2]?.id ?? null,
  score,
  geometry: square(2200 + index * 140, 2400 + (index % 3) * 120, 60),
}));

export const toSharedAiObjects = (taskId: string, slideId: string): SharedAiObjects =>
  sharedAiObjectsSchema.parse({
    task_id: taskId,
    slide_id: slideId,
    result_set_id: resultSetOf(slideId),
    result_name: resultSetOf(slideId) === null ? null : (resultSet?.name ?? null),
    objects: resultSetOf(slideId) === null ? [] : aiCells,
  });

type Check = { checked_at: string | null; nothing_to_mark: boolean };

type SignOff = { at: string; by: string };

type Store = {
  layers: Record<string, LayerObject[]>;
  checks: Record<string, Check>;
  signOffs: Record<string, SignOff>;
};

const empty = (): Store => ({ layers: {}, checks: {}, signOffs: {} });

let memory: Store = empty();

function session(): Storage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

function readStore(): Store {
  const stored = session()?.getItem(storageKey);
  if (stored === null || stored === undefined) return memory;
  return { ...empty(), ...(JSON.parse(stored) as Store) };
}

function writeStore(store: Store): void {
  memory = store;
  session()?.setItem(storageKey, JSON.stringify(store));
}

export function resetFakeSharedLayer(): void {
  memory = empty();
  session()?.removeItem(storageKey);
}

const keyOf = (taskId: string, slideId: string) => `${taskId}/${slideId}`;

const viewerId = () => people[fakeView().viewer].id;

const letters: Record<LayerObject["kind"], string> = {
  roi: "R",
  measurement: "M",
  region: "T+",
  cell: "C+",
  arrow: "A",
  text: "N",
};

const problem = (status: number, code: string, title: string) =>
  HttpResponse.json(
    { type: `https://parfocal.eu/problems/${code}`, title, status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const signedOff = () => problem(409, "slide-signed-off", "This slide is signed off");

const layerOf = (store: Store, key: string) => store.layers[key] ?? [];

const live = (objects: readonly LayerObject[]) =>
  objects.filter((item) => item.deleted_at === null);

function progressOf(objects: readonly LayerObject[], slideId: string): CheckProgress | null {
  if (resultSetOf(slideId) === null) return null;
  const copies = objects.filter((item) => item.source !== null);
  const confirmed = copies.filter((item) => item.origin === "ai-confirmed").length;
  const deleted = copies.filter((item) => item.deleted_at !== null).length;
  const edited = copies.filter(
    (item) => item.origin === "ai-edited" && item.deleted_at === null,
  ).length;
  const checked = confirmed + deleted + edited;
  return {
    scope: aiCells.length,
    checked,
    unchecked: aiCells.length - checked,
    confirmed,
    edited,
    deleted,
  };
}

export function toAnnotateSlideStatus(taskId: string, slideId: string): AnnotateSlideStatus {
  const store = readStore();
  const key = keyOf(taskId, slideId);
  const check = store.checks[key] ?? { checked_at: null, nothing_to_mark: false };
  const signOff = store.signOffs[key];
  const progress = progressOf(layerOf(store, key), slideId);
  return {
    task_id: taskId,
    slide_id: slideId,
    experts: [{ user_id: viewerId(), ...check }],
    signed_off_at: signOff?.at ?? null,
    signed_off_by_user_id: signOff?.by ?? null,
    open_threads: 0,
    unchecked_objects: progress?.unchecked ?? 0,
    all_checked_required: false,
    check_progress: progress,
  };
}

const stamp = () => new Date().toISOString();

function newObject(
  slideId: string,
  existing: readonly LayerObject[],
  fields: Pick<LayerObject, "kind" | "class_id" | "origin" | "source"> & {
    geometry: object;
    text?: string | null;
    code?: string;
  },
): LayerObject {
  const number = existing.filter((item) => item.kind === fields.kind).length + 1;
  const now = stamp();
  return {
    id: crypto.randomUUID(),
    slide_id: slideId,
    kind: fields.kind,
    number,
    code: fields.code ?? `${letters[fields.kind]}${number}`,
    origin: fields.origin,
    source: fields.source,
    geometry: { ...fields.geometry },
    class_id: fields.class_id,
    text: fields.text ?? null,
    version: 1,
    created_by_user_id: viewerId(),
    changed_by_user_id: viewerId(),
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

type Params = { taskId: string; slideId: string };

const base = "*/api/review-tasks/:taskId/slides/:slideId";

function writeLayer(params: Params, change: (objects: LayerObject[]) => LayerObject[]) {
  const store = readStore();
  const key = keyOf(params.taskId, params.slideId);
  writeStore({ ...store, layers: { ...store.layers, [key]: change(layerOf(store, key)) } });
}

const isSignedOff = (params: Params) =>
  readStore().signOffs[keyOf(params.taskId, params.slideId)] !== undefined;

function aiCopy(
  params: Params,
  objectId: string,
  change: (found: LayerObject | undefined) => LayerObject,
) {
  const store = readStore();
  const key = keyOf(params.taskId, params.slideId);
  const objects = layerOf(store, key);
  const found = objects.find((item) => item.source === objectId);
  const made = change(found);
  writeLayer(params, (current) =>
    found === undefined
      ? [...current, made]
      : current.map((item) => (item === found ? made : item)),
  );
  return made;
}

export const sharedLayerDraftOperations: DraftOperation[] = [
  {
    operationId: "listSharedAiObjects",
    method: "get",
    path: "/api/review-tasks/{task_id}/slides/{slide_id}/shared-layer/ai",
    handler: () => getListSharedAiObjectsMockHandler(),
  },
];

export const getListSharedAiObjectsMockHandler = (overrideResponse?: SharedAiObjects) =>
  http.get<Params>(`${base}/shared-layer/ai`, ({ params }) =>
    HttpResponse.json(overrideResponse ?? toSharedAiObjects(params.taskId, params.slideId)),
  );

export const sharedLayerHandlers = (): RequestHandler[] => [
  http.get<Params>(`${base}/shared-layer`, ({ params }) => {
    if (params.taskId !== annotateStubTaskId) return undefined;
    const store = readStore();
    const layer: SharedLayer = {
      task_id: params.taskId,
      slide_id: params.slideId,
      result_set_id: resultSetOf(params.slideId),
      objects: layerOf(store, keyOf(params.taskId, params.slideId)).filter(
        (item) => item.deleted_at === null || item.origin === "ai-edited",
      ),
    };
    return HttpResponse.json(layer);
  }),
  http.post<Params>(`${base}/shared-layer/objects`, async ({ params, request }) => {
    if (isSignedOff(params)) return signedOff();
    const draft = (await request.json()) as AnnotationDraft;
    const store = readStore();
    const made = newObject(params.slideId, layerOf(store, keyOf(params.taskId, params.slideId)), {
      kind: draft.kind,
      geometry: draft.geometry,
      class_id: draft.class_id ?? null,
      text: draft.kind === "text" ? (draft.text?.trim() ?? null) : null,
      origin: "human",
      source: null,
    });
    writeLayer(params, (objects) => [...objects, made]);
    return HttpResponse.json(made, { status: 201 });
  }),
  http.patch<Params & { annotationId: string }>(
    `${base}/shared-layer/objects/:annotationId`,
    async ({ params, request }) => {
      if (isSignedOff(params)) return signedOff();
      const edit = (await request.json()) as AnnotationEdit;
      const found = layerOf(readStore(), keyOf(params.taskId, params.slideId)).find(
        (item) => item.id === params.annotationId,
      );
      if (found === undefined) return new HttpResponse(null, { status: 404 });
      if (found.version !== edit.version)
        return problem(409, "annotation-changed", "This shape changed since you loaded it");
      const changed: LayerObject = {
        ...found,
        geometry: edit.geometry ? { ...edit.geometry } : found.geometry,
        class_id: edit.class_id === undefined ? found.class_id : edit.class_id,
        text: edit.text === undefined ? found.text : (edit.text?.trim() ?? null),
        version: found.version + 1,
        changed_by_user_id: viewerId(),
        updated_at: stamp(),
      };
      writeLayer(params, (objects) => objects.map((item) => (item === found ? changed : item)));
      return HttpResponse.json(changed);
    },
  ),
  http.delete<Params & { annotationId: string }>(
    `${base}/shared-layer/objects/:annotationId`,
    ({ params }) => {
      if (isSignedOff(params)) return signedOff();
      writeLayer(params, (objects) => objects.filter((item) => item.id !== params.annotationId));
      return new HttpResponse(null, { status: 204 });
    },
  ),
  http.put<Params & { objectId: string }>(
    `${base}/shared-layer/ai/:objectId`,
    async ({ params, request }) => {
      if (isSignedOff(params)) return signedOff();
      const edit = (await request.json()) as AiObjectEdit;
      const source = aiCells.find((cell) => cell.object === params.objectId);
      if (source === undefined) return new HttpResponse(null, { status: 404 });
      const store = readStore();
      const made = aiCopy(params, params.objectId, (found) => ({
        ...(found ??
          newObject(params.slideId, layerOf(store, keyOf(params.taskId, params.slideId)), {
            kind: source.kind,
            geometry: source.geometry,
            class_id: source.class_id,
            origin: "ai-edited",
            source: source.object,
            code: source.object,
          })),
        origin: "ai-edited",
        geometry: (edit.geometry ?? found?.geometry ?? source.geometry) as LayerObject["geometry"],
        class_id: edit.class_id ?? found?.class_id ?? source.class_id,
        deleted_at: edit.deleted ? stamp() : null,
        version: (found?.version ?? 0) + 1,
      }));
      return HttpResponse.json(made, { status: 201 });
    },
  ),
  http.post<Params & { objectId: string }>(
    `${base}/shared-layer/ai/:objectId/confirm`,
    ({ params }) => {
      if (isSignedOff(params)) return signedOff();
      const source = aiCells.find((cell) => cell.object === params.objectId);
      if (source === undefined) return new HttpResponse(null, { status: 404 });
      const store = readStore();
      const made = aiCopy(params, params.objectId, (found) => ({
        ...(found ??
          newObject(params.slideId, layerOf(store, keyOf(params.taskId, params.slideId)), {
            kind: source.kind,
            geometry: source.geometry,
            class_id: source.class_id,
            origin: "ai-confirmed",
            source: source.object,
            code: source.object,
          })),
        origin: "ai-confirmed",
        geometry: source.geometry,
        class_id: null,
        deleted_at: null,
        version: (found?.version ?? 0) + 1,
      }));
      return HttpResponse.json(made, { status: 201 });
    },
  ),
  http.delete<Params & { objectId: string }>(
    `${base}/shared-layer/ai/:objectId/confirm`,
    ({ params }) => {
      if (isSignedOff(params)) return signedOff();
      writeLayer(params, (objects) => objects.filter((item) => item.source !== params.objectId));
      return new HttpResponse(null, { status: 204 });
    },
  ),
  http.get<Params>(`${base}/check-status`, ({ params }) =>
    params.taskId === annotateStubTaskId
      ? HttpResponse.json(toAnnotateSlideStatus(params.taskId, params.slideId))
      : undefined,
  ),
  http.post<Params>(`${base}/check`, async ({ params, request }) => {
    if (isSignedOff(params)) return signedOff();
    const text = await request.text();
    const draft = (text === "" ? {} : JSON.parse(text)) as CheckDraft | null;
    const nothing = draft?.nothing_to_mark === true;
    const store = readStore();
    const key = keyOf(params.taskId, params.slideId);
    if (nothing && live(layerOf(store, key)).length > 0)
      return problem(409, "layer-not-empty", "The shared layer has objects");
    writeStore({
      ...store,
      checks: { ...store.checks, [key]: { checked_at: stamp(), nothing_to_mark: nothing } },
    });
    return HttpResponse.json(toAnnotateSlideStatus(params.taskId, params.slideId));
  }),
  http.post<Params>(`${base}/uncheck`, ({ params }) => {
    if (isSignedOff(params)) return signedOff();
    const store = readStore();
    const { [keyOf(params.taskId, params.slideId)]: _gone, ...checks } = store.checks;
    writeStore({ ...store, checks });
    return HttpResponse.json(toAnnotateSlideStatus(params.taskId, params.slideId));
  }),
  http.post<Params>(`${base}/sign-off`, ({ params }) => {
    if (params.taskId !== annotateStubTaskId) return undefined;
    const status = toAnnotateSlideStatus(params.taskId, params.slideId);
    if (status.experts.some((expert) => expert.checked_at === null))
      return problem(409, "experts-unchecked", "Every assigned expert must check the slide first");
    const store = readStore();
    writeStore({
      ...store,
      signOffs: {
        ...store.signOffs,
        [keyOf(params.taskId, params.slideId)]: { at: stamp(), by: viewerId() },
      },
    });
    return HttpResponse.json(toAnnotateSlideStatus(params.taskId, params.slideId));
  }),
];
