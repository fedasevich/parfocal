import { useLingui } from "@lingui/react/macro";
import { useGetMyHome, useGetProject } from "@parfocal/api-client";
import { Loader } from "@parfocal/ui/components/loader";
import type { ReactNode } from "react";
import { useState } from "react";
import { okData } from "../placeholder.tsx";
import { finishingAnswers } from "../review/guided-scenes.ts";
import { type ReviewSession, useReviewSession } from "../review/review-data.ts";
import {
  type Answer,
  type Answers,
  answerOf,
  baseAnswers,
  countAnswers,
} from "../review/review-state.ts";
import type { SlideCounts } from "../review/review-top.tsx";
import { SlidePicture } from "../review/slide-picture.tsx";
import { type PagedReview, usePagedReview } from "../review/use-paged-review.ts";

export type ToolSession = {
  session: ReviewSession;
  paged: PagedReview | null;
  projectId: string;
  projectCode: string;
  answer: (object: string) => Answer | undefined;
  setAnswer: (object: string, value: Answer) => void;
  counts: SlideCounts;
};

function SlideLoader() {
  const { t } = useLingui();
  return <Loader label={t`Loading the slide`} size="page" />;
}

export function WithToolSession({
  projectId,
  slideId,
  task,
  children,
}: {
  projectId: string;
  slideId: string;
  task: string | undefined;
  children: (tools: ToolSession) => ReactNode;
}) {
  const home = okData(useGetMyHome().data);
  const taskId = task ?? home?.resume?.task_id;
  if (taskId === undefined) return <SlideLoader />;
  return (
    <SlidePicture slideId={slideId}>
      <SessionLoader projectId={projectId} slideId={slideId} taskId={taskId}>
        {children}
      </SessionLoader>
    </SlidePicture>
  );
}

function SessionLoader({
  projectId,
  slideId,
  taskId,
  children,
}: {
  projectId: string;
  slideId: string;
  taskId: string;
  children: (tools: ToolSession) => ReactNode;
}) {
  const tools = useToolSession(projectId, slideId, taskId);
  if (tools === null) return <SlideLoader />;
  return children(tools);
}

function useToolSession(projectId: string, slideId: string, taskId: string): ToolSession | null {
  const loaded = useReviewSession(taskId, slideId);
  const paged = usePagedReview(loaded.classes.map((item) => item.name));
  const session = paged
    ? {
        ...loaded,
        objects: [...loaded.objects.filter((item) => item.kind !== "cell"), ...paged.cells],
      }
    : loaded;
  const project = okData(useGetProject(projectId).data);
  const [overrides, setOverrides] = useState<Answers>(new Map());
  if (!session.ready || project === undefined) return null;
  const base = baseAnswers(
    session.objects,
    session.decisions,
    session.style,
    "review",
    finishingAnswers,
    session.classes,
  );
  const answer = (object: string) => answerOf(base, overrides, object);
  return {
    session,
    paged,
    projectId,
    projectCode: project.code,
    answer,
    setAnswer: (object, value) => setOverrides(new Map(overrides).set(object, value)),
    counts: countAnswers(session.objects, answer),
  };
}
