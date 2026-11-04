import { HttpResponse, http, type RequestHandler } from "msw";
import type { Annotation, AnnotationDraft } from "../generated/api.ts";

const storageKey = "parfocal.fake.annotations";

const letters: Record<Annotation["kind"], string> = {
  roi: "R",
  measurement: "M",
  region: "T+",
  cell: "C+",
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
    task_id: null,
    version: 1,
    created_by_user_id: null,
    created_at: stamp,
    updated_at: stamp,
    deleted_at: null,
  };
};

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
  http.delete<{ slideId: string; annotationId: string }>(
    "*/api/slides/:slideId/annotations/:annotationId",
    ({ params }) => {
      const store = readStore();
      const kept = (store[params.slideId] ?? []).filter((item) => item.id !== params.annotationId);
      writeStore({ ...store, [params.slideId]: kept });
      return new HttpResponse(null, { status: 204 });
    },
  ),
];
