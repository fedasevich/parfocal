import { HttpResponse, http, type RequestHandler } from "msw";
import type { Annotation, AnnotationDraft, AnnotationEdit, LayerGroups } from "../generated/api.ts";
import {
  type AddedChange,
  addedObject,
  changeAddedObject,
  drawnOn,
  hiddenAddedIds,
  removeAddedObject,
} from "./added-objects.ts";

const storageKey = "parfocal.fake.annotations";
const groupsKey = "parfocal.fake.layer-groups";

const letters: Record<Annotation["kind"], string> = {
  roi: "R",
  measurement: "M",
  region: "T",
  cell: "C",
  arrow: "A",
  text: "N",
};

const personMade: ReadonlySet<Annotation["kind"]> = new Set(["region", "cell"]);

type Store = Record<string, Annotation[]>;

let memory: Store = {};
let memoryGroups: Record<string, LayerGroups> = {};

function readGroups(): Record<string, LayerGroups> {
  const stored = session()?.getItem(groupsKey);
  return stored === null || stored === undefined
    ? memoryGroups
    : (JSON.parse(stored) as Record<string, LayerGroups>);
}

function writeGroups(groups: Record<string, LayerGroups>): void {
  memoryGroups = groups;
  session()?.setItem(groupsKey, JSON.stringify(groups));
}

function session(): Storage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

function readStore(): Store {
  const stored = session()?.getItem(storageKey);
  if (stored === null || stored === undefined) return memory;
  return JSON.parse(stored) as Store;
}

function writeStore(store: Store): void {
  memory = store;
  session()?.setItem(storageKey, JSON.stringify(store));
}

export function resetFakeAnnotations(): void {
  memory = {};
  memoryGroups = {};
  session()?.removeItem(storageKey);
  session()?.removeItem(groupsKey);
}

export const toSavedAnnotation = (
  slideId: string,
  draft: AnnotationDraft,
  existing: readonly Annotation[],
  now: Date = new Date(),
): Annotation => {
  const number = existing.filter((item) => item.kind === draft.kind).length + 1;
  const stamp = now.toISOString();
  return {
    id: crypto.randomUUID(),
    slide_id: slideId,
    kind: draft.kind,
    number,
    code: `${letters[draft.kind]}${number}${personMade.has(draft.kind) ? "+" : ""}`,
    geometry: { ...draft.geometry },
    class_id: draft.class_id ?? null,
    text: draft.kind === "text" ? (draft.text?.trim() ?? null) : null,
    task_id: null,
    version: 1,
    created_by_user_id: null,
    created_at: stamp,
    updated_at: stamp,
    deleted_at: null,
  };
};

const answerOf = (change: AddedChange) =>
  change.kind === "done"
    ? HttpResponse.json(change.value)
    : change.kind === "stale"
      ? staleProblem()
      : new HttpResponse(null, { status: 404 });

const staleProblem = () =>
  HttpResponse.json(
    {
      type: "https://parfocal.eu/problems/annotation-changed",
      title: "This shape changed since you loaded it",
      status: 409,
      code: "annotation-changed",
    },
    { status: 409, headers: { "content-type": "application/problem+json" } },
  );

const exportSuffixes: Record<string, string> = {
  geojson: "geojson",
  flatgeobuf: "fgb",
  parfocal: "json",
};

const exportMedia: Record<string, string> = {
  geojson: "application/geo+json",
  flatgeobuf: "application/flatgeobuf",
  parfocal: "application/json",
};

function exportBody(format: string, slideId: string, saved: Annotation[]): string {
  if (format === "geojson") {
    return JSON.stringify({
      type: "FeatureCollection",
      features: saved.map((item) => ({
        type: "Feature",
        geometry: item.geometry,
        properties: { id: item.id, kind: item.kind, class_id: item.class_id, text: item.text },
      })),
    });
  }
  if (format === "flatgeobuf") return `fgb:${slideId}:${saved.length}`;
  return JSON.stringify({
    format: "parfocal-results",
    version: 1,
    objects: saved.map((item) => ({
      id: item.id,
      kind: item.kind,
      geometry: item.geometry,
      class: item.class_id,
      text: item.text ?? null,
    })),
  });
}

export const annotationHandlers = (): RequestHandler[] => [
  http.get<{ slideId: string }>("*/api/slides/:slideId/export", ({ params, request }) => {
    const query = new URL(request.url).searchParams;
    const format = query.get("format") ?? "geojson";
    const taskId = query.get("task_id");
    const saved = [
      ...(readStore()[params.slideId] ?? []).filter(
        (item) => taskId === null || item.task_id === taskId || item.task_id === null,
      ),
      ...(taskId === null ? [] : drawnOn(taskId, params.slideId)),
    ];
    return new HttpResponse(exportBody(format, params.slideId, saved), {
      headers: {
        "content-type": exportMedia[format] ?? "application/octet-stream",
        "content-disposition": `attachment; filename="parfocal-export.${exportSuffixes[format] ?? "bin"}"`,
      },
    });
  }),
  http.get<{ slideId: string }>("*/api/slides/:slideId/layer-groups", ({ params }) => {
    const saved = readGroups()[params.slideId] ?? { groups: [], members: [], items: [] };
    const hidden = hiddenAddedIds(params.slideId);
    return HttpResponse.json({
      groups: saved.groups ?? [],
      members: (saved.members ?? []).filter((member) => !hidden.has(member.annotation_id)),
      items: (saved.items ?? []).filter((item) => !hidden.has(item.annotation_id)),
    });
  }),
  http.put<{ slideId: string }>(
    "*/api/slides/:slideId/layer-groups",
    async ({ params, request }) => {
      const body = (await request.json()) as LayerGroups;
      const hidden = hiddenAddedIds(params.slideId);
      const kept = new Set((body.groups ?? []).map((group) => group.id));
      const theirs = (readGroups()[params.slideId]?.members ?? []).filter(
        (member) => hidden.has(member.annotation_id) && kept.has(member.group_id),
      );
      const mine = (body.members ?? []).filter((member) => !hidden.has(member.annotation_id));
      const theirItems = (readGroups()[params.slideId]?.items ?? []).filter((item) =>
        hidden.has(item.annotation_id),
      );
      const myItems = (body.items ?? []).filter((item) => !hidden.has(item.annotation_id));
      writeGroups({
        ...readGroups(),
        [params.slideId]: {
          groups: body.groups ?? [],
          members: [...mine, ...theirs],
          items: [...myItems, ...theirItems],
        },
      });
      return HttpResponse.json({ groups: body.groups ?? [], members: mine, items: myItems });
    },
  ),
  http.get<{ slideId: string }>("*/api/slides/:slideId/annotations", ({ params, request }) => {
    const kind = new URL(request.url).searchParams.get("kind");
    const saved = readStore()[params.slideId] ?? [];
    return HttpResponse.json(kind === null ? saved : saved.filter((item) => item.kind === kind));
  }),
  http.post<{ slideId: string }>(
    "*/api/slides/:slideId/annotations",
    async ({ params, request }) => {
      const draft = (await request.json()) as AnnotationDraft;
      const store = readStore();
      const existing = store[params.slideId] ?? [];
      const created = toSavedAnnotation(params.slideId, draft, existing);
      writeStore({ ...store, [params.slideId]: [...existing, created] });
      return HttpResponse.json(created, { status: 201 });
    },
  ),
  http.get<{ slideId: string; annotationId: string }>(
    "*/api/slides/:slideId/annotations/:annotationId",
    ({ params }) => {
      const found =
        (readStore()[params.slideId] ?? []).find((item) => item.id === params.annotationId) ??
        addedObject(params.slideId, params.annotationId);
      return found === undefined || found === null
        ? new HttpResponse(null, { status: 404 })
        : HttpResponse.json(found);
    },
  ),
  http.patch<{ slideId: string; annotationId: string }>(
    "*/api/slides/:slideId/annotations/:annotationId",
    async ({ params, request }) => {
      const edit = (await request.json()) as AnnotationEdit;
      const store = readStore();
      const existing = store[params.slideId] ?? [];
      const found = existing.find((item) => item.id === params.annotationId);
      if (found === undefined)
        return answerOf(changeAddedObject(params.slideId, params.annotationId, edit));
      if (found.version !== edit.version) return staleProblem();
      const changed: Annotation = {
        ...found,
        geometry:
          edit.geometry === undefined || edit.geometry === null
            ? found.geometry
            : { ...edit.geometry },
        class_id: edit.class_id === undefined ? found.class_id : edit.class_id,
        text: edit.text === undefined ? (found.text ?? null) : (edit.text?.trim() ?? null),
        version: found.version + 1,
        updated_at: new Date().toISOString(),
      };
      writeStore({
        ...store,
        [params.slideId]: existing.map((item) => (item === found ? changed : item)),
      });
      return HttpResponse.json(changed);
    },
  ),
  http.delete<{ slideId: string; annotationId: string }>(
    "*/api/slides/:slideId/annotations/:annotationId",
    ({ params, request }) => {
      const store = readStore();
      const found = (store[params.slideId] ?? []).find((item) => item.id === params.annotationId);
      const version = Number(new URL(request.url).searchParams.get("version"));
      if (found === undefined) {
        const removed = removeAddedObject(params.slideId, params.annotationId, version);
        if (removed.kind === "stale") return staleProblem();
        if (removed.kind === "done") return new HttpResponse(null, { status: 204 });
      }
      if (found !== undefined && version !== found.version) return staleProblem();
      const kept = (store[params.slideId] ?? []).filter((item) => item.id !== params.annotationId);
      writeStore({ ...store, [params.slideId]: kept });
      return new HttpResponse(null, { status: 204 });
    },
  ),
];
