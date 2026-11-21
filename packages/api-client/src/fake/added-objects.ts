import type { AddedDraft, Annotation, AnnotationEdit } from "../generated/api.ts";
import { people } from "./scenario.ts";
import { fakeView } from "./view.ts";

const addedKey = "parfocal.fake.review-added";

type AddedStore = Record<string, Annotation[]>;

let addedMemory: AddedStore = {};

const addedSession = (): Storage | null =>
  typeof sessionStorage === "undefined" ? null : sessionStorage;

const readAdded = (): AddedStore => {
  const stored = addedSession()?.getItem(addedKey);
  return stored === null || stored === undefined ? addedMemory : (JSON.parse(stored) as AddedStore);
};

const writeAdded = (store: AddedStore) => {
  addedMemory = store;
  addedSession()?.setItem(addedKey, JSON.stringify(store));
};

const keyOf = (taskId: string, slideId: string) => `${taskId}/${slideId}`;

const viewerId = () => people[fakeView().viewer].id;

export const addedOn = (taskId: string, slideId: string): Annotation[] =>
  (readAdded()[keyOf(taskId, slideId)] ?? []).filter(
    (item) => item.deleted_at === null && item.created_by_user_id === viewerId(),
  );

export const addObject = (taskId: string, slideId: string, draft: AddedDraft): Annotation => {
  const store = readAdded();
  const kept = store[keyOf(taskId, slideId)] ?? [];
  const number = kept.filter((item) => item.kind === draft.kind).length + 1;
  const now = new Date().toISOString();
  const added: Annotation = {
    id: crypto.randomUUID(),
    slide_id: slideId,
    kind: draft.kind,
    number,
    code: `${draft.kind === "cell" ? "C" : "T"}${number}⁺`,
    geometry: { ...draft.geometry },
    class_id: draft.class_id ?? null,
    task_id: taskId,
    version: 1,
    created_by_user_id: viewerId(),
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  writeAdded({ ...store, [keyOf(taskId, slideId)]: [...kept, added] });
  return added;
};

const located = (slideId: string, id: string) => {
  const store = readAdded();
  for (const [key, items] of Object.entries(store)) {
    const found = items.find((item) => item.id === id && item.slide_id === slideId);
    if (found !== undefined) return { store, key, items, found };
  }
  return null;
};

export const addedObject = (slideId: string, id: string): Annotation | null => {
  const found = located(slideId, id)?.found;
  return found === undefined || found.created_by_user_id !== viewerId() ? null : found;
};

export type AddedChange =
  | { readonly kind: "missing" }
  | { readonly kind: "stale" }
  | { readonly kind: "done"; readonly value: Annotation };

const replaced = (where: NonNullable<ReturnType<typeof located>>, next: Annotation): Annotation => {
  writeAdded({
    ...where.store,
    [where.key]: where.items.map((item) => (item === where.found ? next : item)),
  });
  return next;
};

export const changeAddedObject = (
  slideId: string,
  id: string,
  edit: AnnotationEdit,
): AddedChange => {
  const where = located(slideId, id);
  if (where === null || where.found.created_by_user_id !== viewerId()) return { kind: "missing" };
  if (where.found.version !== edit.version || where.found.deleted_at !== null) {
    return { kind: "stale" };
  }
  return {
    kind: "done",
    value: replaced(where, {
      ...where.found,
      geometry:
        edit.geometry === undefined || edit.geometry === null
          ? where.found.geometry
          : { ...edit.geometry },
      class_id: edit.class_id === undefined ? where.found.class_id : edit.class_id,
      version: where.found.version + 1,
      updated_at: new Date().toISOString(),
    }),
  };
};

export const removeAddedObject = (slideId: string, id: string, version: number): AddedChange => {
  const where = located(slideId, id);
  if (where === null || where.found.created_by_user_id !== viewerId()) return { kind: "missing" };
  if (where.found.version !== version) return { kind: "stale" };
  const now = new Date().toISOString();
  return {
    kind: "done",
    value: replaced(where, {
      ...where.found,
      version: where.found.version + 1,
      deleted_at: now,
      updated_at: now,
    }),
  };
};
