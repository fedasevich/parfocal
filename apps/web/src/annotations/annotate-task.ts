import type {
  AnnotateSlideStatus,
  LayerObject,
  ProjectClass,
  ReviewTaskDetail,
  SharedAiObject,
} from "@parfocal/api-client";
import type { CheckState } from "./check-state.ts";
import { maxClassKeys } from "./classes.ts";

export type LayerOrigin = "ai" | "ai-edited" | "ai-confirmed" | "human";

export type AnnotateTask = {
  readonly taskId: string;
  readonly slideId: string;
  readonly resultSetId: string | null;
  readonly classes: readonly ProjectClass[] | null;
  readonly slideIds: readonly string[];
  readonly owner: boolean;
};

export function annotateTaskOf(
  task: ReviewTaskDetail | undefined,
  slideId: string,
  owner: boolean,
): AnnotateTask | null {
  if (task === undefined || task.kind !== "annotate") return null;
  return {
    taskId: task.id,
    slideId,
    resultSetId: task.slides.find((slide) => slide.slide_id === slideId)?.result_set_id ?? null,
    classes: task.classes,
    slideIds: task.slides.map((slide) => slide.slide_id),
    owner,
  };
}

export function taskClassesOf(
  snapshot: readonly ProjectClass[] | null | undefined,
  project: readonly ProjectClass[],
): ProjectClass[] {
  return [...(snapshot ?? project)].sort((left, right) => left.key - right.key);
}

export type ClassSlot = {
  readonly id: string;
  readonly name: string;
  readonly slot: number | null;
};

export const classSlotsOf = (classes: readonly ProjectClass[]): ClassSlot[] =>
  classes.map((item, index) => ({
    id: item.id,
    name: item.name,
    slot: index < maxClassKeys ? index + 1 : null,
  }));

export type AiResultView = {
  readonly available: boolean;
  readonly shown: boolean;
  readonly label: string;
};

export function aiResultViewOf(
  resultSetId: string | null,
  resultName: string | null,
  hidden: boolean,
): AiResultView {
  if (resultSetId === null) {
    return { available: false, shown: false, label: "No AI result on this slide" };
  }
  const name = resultName ?? "AI result";
  return hidden
    ? { available: true, shown: false, label: "AI result hidden" }
    : { available: true, shown: true, label: `AI result on · ${name}` };
}

export type CheckedAiObject = SharedAiObject & {
  readonly check: CheckState;
  readonly origin: LayerOrigin;
  readonly copy: LayerObject | undefined;
};

function checkOfCopy(copy: LayerObject | undefined): CheckState {
  if (copy === undefined) return "unchecked";
  if (copy.deleted_at !== null) return "deleted";
  return copy.origin === "ai-confirmed" ? "confirmed" : "edited";
}

export function aiWithChecks(
  objects: readonly SharedAiObject[],
  layer: readonly LayerObject[],
): CheckedAiObject[] {
  const copies = new Map(
    layer.flatMap((item) => (item.source === null ? [] : [[item.source, item] as const])),
  );
  return objects.map((object) => {
    const copy = copies.get(object.object);
    return {
      ...object,
      check: checkOfCopy(copy),
      origin: copy === undefined ? "ai" : copy.origin,
      copy,
    };
  });
}

export const aiCheckCounts = (objects: readonly CheckedAiObject[]) => ({
  total: objects.length,
  confirmed: objects.filter((object) => object.check === "confirmed").length,
  edited: objects.filter((object) => object.check === "edited").length,
  deleted: objects.filter((object) => object.check === "deleted").length,
});

export type OriginMarkInfo = { readonly origin: LayerOrigin; readonly authorId: string | null };

export function originMarkOf(
  object: Pick<LayerObject, "origin" | "created_by_user_id" | "changed_by_user_id">,
): OriginMarkInfo {
  if (object.origin === "human") return { origin: "human", authorId: object.created_by_user_id };
  return { origin: object.origin, authorId: object.changed_by_user_id };
}

export type ClassCount = { readonly id: string; readonly name: string; readonly count: number };

export function classCountsOf(
  classes: readonly ProjectClass[],
  objects: readonly { readonly class_id: string | null }[],
): ClassCount[] {
  return classes.map((item) => ({
    id: item.id,
    name: item.name,
    count: objects.filter((object) => object.class_id === item.id).length,
  }));
}

export type SlideStep = "open" | "checked" | "signed-off";

export function slideStepOf(status: AnnotateSlideStatus | undefined, me: string | null): SlideStep {
  if (status === undefined) return "open";
  if (status.signed_off_at !== null) return "signed-off";
  const mine = status.experts.find((expert) => expert.user_id === me);
  return mine?.checked_at ? "checked" : "open";
}

export type TaskProgress = {
  readonly total: number;
  readonly checked: number;
  readonly signedOff: number;
  readonly line: string;
};

export function taskProgressOf(
  statuses: readonly (AnnotateSlideStatus | undefined)[],
  me: string | null,
): TaskProgress {
  const steps = statuses.map((status) => slideStepOf(status, me));
  const signedOff = steps.filter((step) => step === "signed-off").length;
  const checked = steps.filter((step) => step !== "open").length;
  const total = statuses.length;
  const line =
    signedOff > 0
      ? `${checked} of ${total} slides checked, ${signedOff} signed off`
      : `${checked} of ${total} slides checked`;
  return { total, checked, signedOff, line };
}

export function canSignOff(status: AnnotateSlideStatus | undefined, owner: boolean): boolean {
  if (!owner || status === undefined || status.signed_off_at !== null) return false;
  return status.experts.length > 0 && status.experts.every((expert) => expert.checked_at !== null);
}

export function nextSlideOf(
  slideIds: readonly string[],
  current: string,
  statuses: readonly (AnnotateSlideStatus | undefined)[],
  me: string | null,
): string | null {
  const start = slideIds.indexOf(current);
  for (let step = 1; step < slideIds.length; step += 1) {
    const index = (start + step) % slideIds.length;
    if (slideStepOf(statuses[index], me) === "open") return slideIds[index] ?? null;
  }
  return null;
}
