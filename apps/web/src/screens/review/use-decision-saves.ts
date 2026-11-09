import {
  getGetReviewedLayerQueryKey,
  getListVerdictsQueryKey,
  type PolygonGeometry,
  useClearReviewEdit,
  useClearVerdict,
  useSaveReviewEdit,
  useSaveVerdict,
  type VerdictDraft,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { taskTimer } from "../../telemetry/app-events.ts";
import { type Count, decisionBody, type ReviewStyle, shownCall } from "./decision-style.ts";
import { toMentionTokens } from "./mention-picking.ts";
import type { ReviewSession } from "./review-data.ts";
import type { Answer } from "./review-state.ts";
import { useMentionable } from "./use-mentionable.ts";

export function useDecisionSaves(session: ReviewSession, style: ReviewStyle) {
  const queryClient = useQueryClient();
  const members = useMentionable();
  const { taskId, slideId, classes, objects } = session;
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getListVerdictsQueryKey(taskId, slideId) });
  const saver = useSaveVerdict({ mutation: { onSuccess: refresh } });
  const clearer = useClearVerdict({ mutation: { onSuccess: refresh } });
  const save = (
    objectId: string,
    raw: string,
    value: Count,
    reasons?: Pick<VerdictDraft, "reasons" | "reason_class_id">,
    note?: string | null,
  ) => {
    if (objects.find((item) => item.object === objectId)?.kind === "cell") {
      taskTimer.cellDecided(slideId);
    }
    saver.mutate({
      taskId,
      slideId,
      objectId,
      data: {
        ...decisionBody(style, raw, classes, value),
        ...shownCall(
          objects.find((item) => item.object === objectId),
          classes,
        ),
        ...reasons,
        ...(note ? { note: toMentionTokens(note, members) } : {}),
      },
    });
  };
  const refreshLayer = () =>
    void queryClient.invalidateQueries({ queryKey: getGetReviewedLayerQueryKey(taskId, slideId) });
  const edits = useSaveReviewEdit({ mutation: { onSuccess: refreshLayer } });
  const unedit = useClearReviewEdit({ mutation: { onSuccess: refreshLayer } });
  const saveOutline = (objectId: string, geometry: PolygonGeometry) =>
    edits.mutate({ taskId, slideId, objectId, data: { geometry } });
  const clearOutline = (objectId: string) => unedit.mutate({ taskId, slideId, objectId });
  const restore = (objectId: string, before: Answer | undefined) => {
    if (before === undefined) clearer.mutate({ taskId, slideId, objectId });
    else save(objectId, before.raw, before.value);
  };
  return { save, restore, saveOutline, clearOutline };
}
