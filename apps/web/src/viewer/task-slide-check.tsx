import { Trans, useLingui } from "@lingui/react/macro";
import { ApiError, useGetReviewTask, useListReviewObjects } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { okData } from "../screens/placeholder.tsx";
import { IssuePage } from "../shell/issue-pages.tsx";
import { slidePath } from "../shell/slide-link.ts";

const notFound = (error: unknown) => error instanceof ApiError && error.status === 404;

export function TaskSlideCheck({
  projectId,
  taskId,
  slideId,
  children,
}: {
  projectId: string;
  taskId: string | undefined;
  slideId: string;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const taskQuery = useGetReviewTask(taskId ?? "", { query: { enabled: taskId !== undefined } });
  const task = okData(taskQuery.data);
  const reviewing = taskId !== undefined && task?.kind === "review";
  const objects = useListReviewObjects(taskId ?? "", slideId, { query: { enabled: reviewing } });
  const taskGone = taskId !== undefined && notFound(taskQuery.error);
  const outside = reviewing && notFound(objects.error);
  if (!taskGone && !outside) return children;
  const firstSlide = task?.slides[0]?.slide_id;
  const taskName = task?.name ?? t`The task`;
  const openTask =
    task !== undefined && firstSlide !== undefined && taskId !== undefined ? (
      <Button
        variant="primary"
        onClick={() =>
          void navigate({
            to: slidePath,
            params: { projectId: task.project_id, slideId: firstSlide },
            search: { task: taskId },
          })
        }
      >
        <Trans>Open the task</Trans>
      </Button>
    ) : null;
  return (
    <IssuePage
      testId="issue-slide-outside-task"
      icon="warn"
      title={taskGone ? t`This task cannot be opened` : t`This slide is not part of the task`}
      happened={
        taskGone
          ? t`The task in this address does not exist, or it was deleted.`
          : t`${taskName} does not include this slide, so there is nothing to review on it here.`
      }
      stillWorks={t`You can open the task, or look at the slide on its own. Nothing was changed.`}
      actions={
        <>
          {openTask}
          <Button
            variant={openTask === null ? "primary" : "secondary"}
            onClick={() => void navigate({ to: slidePath, params: { projectId, slideId } })}
          >
            <Trans>Open the slide alone</Trans>
          </Button>
        </>
      }
    />
  );
}
