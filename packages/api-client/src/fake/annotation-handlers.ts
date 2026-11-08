import { HttpResponse, http, type RequestHandler } from "msw";
import type { Annotation, AnnotationDraft, AnnotationEdit } from "../generated/api.ts";

const storageKey = "parfocal.fake.annotations";

const letters: Record<Annotation["kind"], string> = {
  roi: "R",
  measurement: "M",
  region: "T+",
  cell: "C+",
  arrow: "A",
  text: "N",
};

type Store = Record<string, Annotation[]>;

let memory: Store = {};

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
  session()?.removeItem(storageKey);
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
    code: `${letters[draft.kind]}${number}`,
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

export const annotationHandlers = (): RequestHandler[] => [
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
      const found = (readStore()[params.slideId] ?? []).find(
        (item) => item.id === params.annotationId,
      );
      return found === undefined
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
      if (found === undefined) return new HttpResponse(null, { status: 404 });
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
      if (found !== undefined && version !== found.version) return staleProblem();
      const kept = (store[params.slideId] ?? []).filter((item) => item.id !== params.annotationId);
      writeStore({ ...store, [params.slideId]: kept });
      return new HttpResponse(null, { status: 204 });
    },
  ),
];
