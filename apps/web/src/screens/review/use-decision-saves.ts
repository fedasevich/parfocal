import { useLingui } from "@lingui/react/macro";
import {
  getGetReviewedLayerQueryKey,
  getListDecisionsQueryKey,
  type listDecisionsResponse,
  type PolygonGeometry,
  type ReviewDecisionDraft,
  useClearDecision,
  useClearDecisionBatch,
  useClearReviewEdit,
  useSaveDecision,
  useSaveDecisionBatch,
  useSaveReviewEdit,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { showUndoToast } from "../../shell/undo-toasts.tsx";
import { taskTimer } from "../../telemetry/app-events.ts";
import { type Count, decisionBody, type ReviewStyle, shownCall } from "./decision-style.ts";
import { toMentionTokens } from "./mention-picking.ts";
import type { ReasonBody } from "./note-model.ts";
import type { ReviewSession } from "./review-data.ts";
import type { Answer, Answers } from "./review-state.ts";
import { useMentionable } from "./use-mentionable.ts";

export function withoutAnswers(answers: Answers, objectIds: string[]): Answers {
  const next = new Map(answers);
  for (const objectId of objectIds) next.delete(objectId);
  return next;
}

export function useDecisionSaves(
  session: ReviewSession,
  style: ReviewStyle,
  onFailed?: (objectId: string) => void,
) {
  const queryClient = useQueryClient();
  const { t } = useLingui();
  const members = useMentionable();
  const { taskId, slideId, classes, objects } = session;
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getListDecisionsQueryKey(taskId, slideId) });
  const saver = useSaveDecision({
    mutation: {
      onSuccess: refresh,
      onError: (_error, variables) => onFailed?.(variables.objectId),
    },
  });
  const clearer = useClearDecision({ mutation: { onSuccess: refresh } });
  const save = (
    objectId: string,
    raw: string,
    value: Count,
    reasons?: Pick<ReviewDecisionDraft, "reasons" | "reason_class_id">,
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
  const reasonSaver = useSaveDecision();
  const reasonQueue = useRef<Promise<unknown>>(Promise.resolve());
  const reasonsInFlight = useRef(0);
  const saveReasons = (
    objectId: string,
    raw: string,
    value: Count,
    reasons: ReasonBody,
    note?: string | null,
  ) => {
    const key = getListDecisionsQueryKey(taskId, slideId);
    void queryClient.cancelQueries({ queryKey: key });
    const before = queryClient.getQueryData<listDecisionsResponse>(key);
    queryClient.setQueryData<listDecisionsResponse>(key, (old) =>
      old?.status === 200
        ? {
            ...old,
            data: old.data.map((decision) =>
              decision.object === objectId ? { ...decision, ...reasons } : decision,
            ),
          }
        : old,
    );
    const variables = {
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
    };
    reasonsInFlight.current += 1;
    const run = reasonQueue.current.then(() => reasonSaver.mutateAsync(variables));
    reasonQueue.current = run.catch(() => undefined);
    return run.then(
      async () => {
        reasonsInFlight.current -= 1;
        if (reasonsInFlight.current === 0) await queryClient.invalidateQueries({ queryKey: key });
        return true;
      },
      () => {
        reasonsInFlight.current -= 1;
        if (before !== undefined) queryClient.setQueryData(key, before);
        if (reasonsInFlight.current === 0) void queryClient.invalidateQueries({ queryKey: key });
        showUndoToast({
          message: t`The reasons for ${objectId} were not saved. They are back as they were.`,
        });
        return false;
      },
    );
  };
  const batchSaver = useSaveDecisionBatch();
  const batchClearer = useClearDecisionBatch();
  const saveAll = async (items: { objectId: string; raw: string }[], value: Count) => {
    try {
      await batchSaver.mutateAsync({
        taskId,
        slideId,
        data: {
          decisions: items.map(({ objectId, raw }) => ({
            object: objectId,
            ...decisionBody(style, raw, classes, value),
            ...shownCall(
              objects.find((item) => item.object === objectId),
              classes,
            ),
          })),
        },
      });
    } finally {
      refresh();
    }
  };
  const clearAll = async (objectIds: string[]) => {
    try {
      await batchClearer.mutateAsync({ taskId, slideId, data: { objects: objectIds } });
    } finally {
      refresh();
    }
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
  return { save, saveReasons, saveAll, restore, clearAll, saveOutline, clearOutline };
}
