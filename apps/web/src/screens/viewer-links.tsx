import { Trans, useLingui } from "@lingui/react/macro";
import { useGetReviewTask } from "@parfocal/api-client";
import { buttonVariants } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Link } from "@tanstack/react-router";
import { okData } from "./placeholder.tsx";

export type ViewerTarget = {
  projectId: string;
  slideId: string;
  taskId?: string | undefined;
  object?: string | undefined;
};

export const viewerSearch = (target: Pick<ViewerTarget, "taskId" | "object">) => ({
  task: target.taskId,
  object: target.object,
  workspace: "review" as const,
});

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

export function ViewerLink({ target, label }: { target: ViewerTarget; label: string }) {
  return (
    <Link
      to="/projects/$projectId/slides/$slideId"
      params={{ projectId: target.projectId, slideId: target.slideId }}
      search={viewerSearch(target)}
      aria-label={label}
      title={label}
      data-testid="viewer-link"
      onClick={stop}
      className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
    >
      <Icon name="eye" />
    </Link>
  );
}

const small = buttonVariants({ size: "sm", variant: "ghost" });

export function TaskViewerLinks({ taskId, projectId }: { taskId: string; projectId: string }) {
  const { t } = useLingui();
  const detail = okData(useGetReviewTask(taskId).data);
  const first = detail?.slides[0]?.slide_id;
  const review = detail?.kind !== "annotate";
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="task-viewer-links">
      {first ? (
        <Link
          to="/projects/$projectId/slides/$slideId"
          params={{ projectId, slideId: first }}
          search={viewerSearch({ taskId })}
          title={t`Open the slides of this task in the full viewer`}
          onClick={stop}
          className={small}
        >
          <Icon name="eye" />
          <Trans>Slides</Trans>
        </Link>
      ) : null}
      {detail && review ? (
        <>
          <Link to="/tasks/$taskId/evaluation" params={{ taskId }} onClick={stop} className={small}>
            <Trans>Evaluation</Trans>
          </Link>
          <Link
            to="/tasks/$taskId/disagreements"
            params={{ taskId }}
            onClick={stop}
            className={small}
          >
            <Trans>Disagreements</Trans>
          </Link>
        </>
      ) : null}
    </span>
  );
}
