import { getListVerdictsQueryKey, useClearVerdict, useSaveVerdict } from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { type Count, decisionBody, type ReviewStyle } from "./decision-style.ts";
import type { ReviewSession } from "./review-data.ts";
import type { Answer } from "./review-state.ts";

export function useDecisionSaves(session: ReviewSession, style: ReviewStyle) {
  const queryClient = useQueryClient();
  const { taskId, slideId, classes } = session;
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getListVerdictsQueryKey(taskId, slideId) });
  const saver = useSaveVerdict({ mutation: { onSuccess: refresh } });
  const clearer = useClearVerdict({ mutation: { onSuccess: refresh } });
  const save = (objectId: string, raw: string, value: Count) =>
    saver.mutate({ taskId, slideId, objectId, data: decisionBody(style, raw, classes, value) });
  const restore = (objectId: string, before: Answer | undefined) => {
    if (before === undefined) clearer.mutate({ taskId, slideId, objectId });
    else save(objectId, before.raw, before.value);
  };
  return { save, restore };
}
