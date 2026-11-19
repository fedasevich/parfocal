import { Trans, useLingui } from "@lingui/react/macro";
import { useSubmitSlideReview } from "@parfocal/api-client";
import { InlineState } from "@parfocal/ui/components/banner";
import { SlideDoneCard, type SlideDoneCounts } from "@parfocal/ui/components/slide-done-card";
import { useNavigate } from "@tanstack/react-router";
import { opinionQuestions, questionBlockers } from "../screens/review/guided-blockers.ts";
import { type ReviewSession, useReviewSession } from "../screens/review/review-data.ts";
import { useOpinionDraft } from "../screens/review/use-opinion-draft.ts";

export function slideDoneCounts(session: ReviewSession): SlideDoneCounts {
  const counts = { total: session.objects.length, agree: 0, disagree: 0, unsure: 0, open: 0 };
  for (const object of session.objects) {
    const value = session.decisions.get(object.object)?.value;
    if (value === "agree" || value === "disagree" || value === "unsure") counts[value] += 1;
    else counts.open += 1;
  }
  return { ...counts, added: session.added.length };
}

type OpinionProps = {
  taskId: string;
  slideId: string;
  onObjects: (object?: string) => void;
};

export function ReviewOpinion({ taskId, slideId, onObjects }: OpinionProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const session = useReviewSession(taskId, slideId);
  const { answers, change } = useOpinionDraft(session);
  const submitReview = useSubmitSlideReview();
  const questions = opinionQuestions(session, answers, []);
  const counts = slideDoneCounts(session);
  const open = session.objects
    .filter((object) => !session.decisions.has(object.object))
    .map((object) => ({
      id: object.object,
      text: t`${object.object} is still open`,
      goTo: t`Go to ${object.object}`,
      onGoTo: () => onObjects(object.object),
    }));
  const blockers = open.length > 0 ? open : questionBlockers(questions, answers);
  return (
    <SlideDoneCard
      panel
      data-testid="stage-opinion"
      slideNumber={session.neighbours?.position ?? 1}
      counts={counts}
      questions={questions}
      blockers={blockers}
      submitLabel={t`Submit`}
      onAnswerChange={change}
      onSubmit={() => {
        submitReview.mutate({ taskId, slideId });
        void navigate({
          to: "/tasks/$taskId/submitted",
          params: { taskId },
          search: { slide: slideId },
        });
      }}
    />
  );
}

export function StageOpinion({
  taskId,
  slideId,
  reviewTask,
  onObjects,
}: {
  taskId: string | undefined;
  slideId: string;
  reviewTask: boolean;
  onObjects: () => void;
}) {
  if (taskId !== undefined && reviewTask)
    return <ReviewOpinion taskId={taskId} slideId={slideId} onObjects={onObjects} />;
  return (
    <InlineState data-testid="stage-opinion" icon="info" title={<Trans>No opinion asked</Trans>}>
      <Trans>
        The opinion questions belong to a review task. Open this slide from one to answer them.
      </Trans>
    </InlineState>
  );
}
