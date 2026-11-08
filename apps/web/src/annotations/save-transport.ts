import {
  type AnnotationDraft,
  type AnnotationEdit,
  ApiError,
  changeAnnotation,
  changeSharedObject,
  createAnnotation,
  createSharedObject,
  deleteAnnotation,
  deleteSharedObject,
  getAnnotation,
} from "@parfocal/api-client";
import { theirsFromCurrent, vanished } from "./conflicts.ts";
import { classifyStatus, type Outcome, type Transport } from "./save-queue.ts";

const failure = (status: number): Outcome<never> => ({
  kind: classifyStatus(status) === "retry" ? "retry" : "rejected",
});

export const failureOf = (error: unknown): Outcome<never> =>
  error instanceof ApiError && error.kind !== "network" ? failure(error.status) : { kind: "retry" };

const isStale = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.status === 409;

const isGone = (error: unknown) => error instanceof ApiError && error.status === 404;

export const editOf = (version: number, body: AnnotationDraft): AnnotationEdit => ({
  version,
  geometry: body.geometry,
  ...(body.kind === "cell" || body.class_id !== undefined
    ? { class_id: body.class_id ?? null }
    : {}),
  ...(body.kind === "text" ? { text: body.text ?? null } : {}),
});

export function annotationTransport(slideId: string): Transport<AnnotationDraft> {
  const conflictAt = async (id: string, version: number): Promise<Outcome<never>> => {
    try {
      const response = await getAnnotation(slideId, id);
      const theirs = theirsFromCurrent(response.data);
      return theirs === null ? { kind: "retry" } : { kind: "conflict", theirs };
    } catch (error) {
      if (isGone(error)) return { kind: "conflict", theirs: vanished(version + 1) };
      return failureOf(error);
    }
  };
  return {
    create: async (body) => {
      try {
        const response = await createAnnotation(slideId, body);
        if (response.status !== 201) return failure(response.status);
        return { kind: "done", value: { id: response.data.id, version: response.data.version } };
      } catch (error) {
        return failureOf(error);
      }
    },
    update: async (id, version, body) => {
      try {
        const response = await changeAnnotation(slideId, id, editOf(version, body));
        if (response.status !== 200) return failure(response.status);
        return { kind: "done", value: { version: response.data.version } };
      } catch (error) {
        return isStale(error) ? conflictAt(id, version) : failureOf(error);
      }
    },
    remove: async (id, version) => {
      try {
        await deleteAnnotation(slideId, id, { version });
        return { kind: "done", value: null };
      } catch (error) {
        if (isGone(error)) return { kind: "done", value: null };
        return isStale(error) ? conflictAt(id, version) : failureOf(error);
      }
    },
  };
}

export function sharedLayerTransport(taskId: string, slideId: string): Transport<AnnotationDraft> {
  const conflictOf = (error: ApiError): Outcome<never> => {
    const theirs = theirsFromCurrent(error.problem?.current);
    return theirs === null ? { kind: "rejected" } : { kind: "conflict", theirs };
  };
  return {
    create: async (body) => {
      try {
        const response = await createSharedObject(taskId, slideId, body);
        if (response.status !== 201) return failure(response.status);
        return { kind: "done", value: { id: response.data.id, version: response.data.version } };
      } catch (error) {
        return failureOf(error);
      }
    },
    update: async (id, version, body) => {
      try {
        const response = await changeSharedObject(taskId, slideId, id, editOf(version, body));
        if (response.status !== 200) return failure(response.status);
        return { kind: "done", value: { version: response.data.version } };
      } catch (error) {
        return isStale(error) ? conflictOf(error) : failureOf(error);
      }
    },
    remove: async (id, version) => {
      try {
        await deleteSharedObject(taskId, slideId, id, { version });
        return { kind: "done", value: null };
      } catch (error) {
        if (isGone(error)) return { kind: "done", value: null };
        return isStale(error) ? conflictOf(error) : failureOf(error);
      }
    },
  };
}
