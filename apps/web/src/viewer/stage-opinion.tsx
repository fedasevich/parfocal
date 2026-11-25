import { Trans, useLingui } from "@lingui/react/macro";
import { useSubmitSlideReview } from "@parfocal/api-client";
import { InlineState } from "@parfocal/ui/components/banner";
import type { Blocker } from "@parfocal/ui/components/before-you-list";
import { SlideDoneCard, type SlideDoneCounts } from "@parfocal/ui/components/slide-done-card";
import { useNavigate } from "@tanstack/react-router";
import type { Count } from "../screens/review/decision-style.ts";
import { opinionQuestions, questionBlockers } from "../screens/review/guided-blockers.ts";
import { type ReviewSession, useReviewSession } from "../screens/review/review-data.ts";
import { pendingOrder } from "../screens/review/review-order-state.ts";
import { ReviewOrderOpinionNotice } from "../screens/review/review-order-state.tsx";
import { useOpinionDraft } from "../screens/review/use-opinion-draft.ts";

export type PendingDecisions = ReadonlyMap<string, Count>;

export function slideDoneCounts(
  session: ReviewSession,
  pending: PendingDecisions = new Map(),
): SlideDoneCounts {
  const counts = { total: session.objects.length, agree: 0, disagree: 0, unsure: 0, open: 0 };
  for (const object of session.objects) {
    const value = session.decisions.get(object.object)?.value ?? pending.get(object.object);
    if (value === "agree" || value === "disagree" || value === "unsure") counts[value] += 1;
    else counts.open += 1;
  }
  return { ...counts, added: session.added.length };
}

type OpinionProps = {
  taskId: string;
  slideId: string;
  readOnly?: string | undefined;
  onObjects: (object?: string) => void;
  pending?: PendingDecisions;
};

export type SlideSubmit = { submit: () => void; sending: boolean; failed: boolean };

export function useSlideSubmit(taskId: string | null, slideId: string): SlideSubmit {
  const navigate = useNavigate();
  const submitReview = useSubmitSlideReview();
  const submit = () => {
    if (taskId === null || submitReview.isPending) return;
    submitReview.mutate(
      { taskId, slideId },
      {
        onSuccess: () =>
          void navigate({
            to: "/tasks/$taskId/submitted",
            params: { taskId },
            search: { slide: slideId },
          }),
      },
    );
  };
  return { submit, sending: submitReview.isPending, failed: submitReview.isError };
}

export function ReviewOpinion({ taskId, slideId, readOnly, onObjects, pending }: OpinionProps) {
  const session = useReviewSession(taskId, slideId);
  const draft = useOpinionDraft(session);
  return (
    <OpinionForm
      session={session}
      draft={draft}
      readOnly={readOnly}
      onObjects={onObjects}
      {...(pending ? { pending } : {})}
    />
  );
}

export function OpinionForm({
  session,
  draft: { answers, change },
  readOnly,
  onObjects,
  pending = new Map(),
}: {
  session: ReviewSession;
  draft: Pick<ReturnType<typeof useOpinionDraft>, "answers" | "change">;
  readOnly?: string | undefined;
  onObjects: (object?: string) => void;
  pending?: PendingDecisions;
}) {
  const { t } = useLingui();
  const questions = opinionQuestions(session, answers, []);
  const counts = slideDoneCounts(session, pending);
  const undecided = session.objects.filter(
    (object) => !session.decisions.has(object.object) && !pending.has(object.object),
  );
  const openRegions = undecided.filter((object) => object.kind !== "cell");
  const openCells = undecided.filter((object) => object.kind === "cell");
  const open: Blocker[] = [
    ...openRegions.map((object) => ({
      id: object.object,
      text: t`${object.object} is still open`,
      goTo: t`Go to ${object.object}`,
      onGoTo: () => onObjects(object.object),
    })),
    ...(openCells.length > 0
      ? [
          {
            id: "cells",
            text:
              openCells.length === 1
                ? t`1 cell in the sample is still open`
                : t`${openCells.length} cells in the sample are still open`,
            goTo: t`Go to the cells`,
            onGoTo: () => onObjects("cells"),
          },
        ]
      : []),
  ];
  const blockers = open.length > 0 ? open : questionBlockers(questions, answers);
  if (pendingOrder(session.order, session.ready) !== null) return <ReviewOrderOpinionNotice />;
  return (
    <SlideDoneCard
      panel
      formOnly
      data-testid="stage-opinion"
      slideNumber={session.neighbours?.position ?? 1}
      counts={counts}
      questions={questions}
      blockers={blockers}
      submitLabel={t`Submit`}
      readOnly={readOnly}
      {...(readOnly === undefined ? { onAnswerChange: change } : {})}
    />
  );
}

export function StageOpinion({
  taskId,
  slideId,
  reviewTask,
  readOnly,
  onObjects,
}: {
  taskId: string | undefined;
  slideId: string;
  reviewTask: boolean;
  readOnly?: string | undefined;
  onObjects: (object?: string) => void;
}) {
  if (taskId !== undefined && reviewTask)
    return (
      <ReviewOpinion taskId={taskId} slideId={slideId} readOnly={readOnly} onObjects={onObjects} />
    );
  return (
    <InlineState data-testid="stage-opinion" icon="info" title={<Trans>No opinion asked</Trans>}>
      <Trans>
        The opinion questions belong to a review task. Open this slide from one to answer them.
      </Trans>
    </InlineState>
  );
}
