import { type AnnotationDraft, createAnnotation, deleteAnnotation } from "@parfocal/api-client";
import { classifyStatus, type Transport } from "./save-queue.ts";

export function annotationTransport(slideId: string): Transport<AnnotationDraft> {
  return {
    create: async (body) => {
      const response = await createAnnotation(slideId, body);
      if (response.status === 201) {
        return { kind: "done", value: { id: response.data.id, version: response.data.version } };
      }
      return { kind: classifyStatus(response.status) === "retry" ? "retry" : "rejected" };
    },
    remove: async (id, version) => {
      const response = await deleteAnnotation(slideId, id, { version });
      if (response.status === 204 || response.status === 404) return { kind: "done", value: null };
      return { kind: classifyStatus(response.status) === "retry" ? "retry" : "rejected" };
    },
  };
}
