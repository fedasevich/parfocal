import { Trans, useLingui } from "@lingui/react/macro";
import { useGetReviewTask } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Loader } from "@parfocal/ui/components/loader";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { okData } from "../screens/placeholder.tsx";
import { IssuePage } from "./issue-pages.tsx";

export function ReviewTaskOnly({
  taskId,
  what,
  children,
}: {
  taskId: string;
  what: "evaluation" | "disagreements";
  children: ReactNode;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const query = useGetReviewTask(taskId);
  const task = okData(query.data);
  if (query.isPending) return <Loader label={t`Opening the task`} size="page" />;
  if (task?.kind !== "annotate") return children;
  return (
    <IssuePage
      testId="issue-annotate-task-has-none"
      icon="warn"
      title={
        what === "evaluation"
          ? t`Annotate tasks have no evaluation`
          : t`Annotate tasks have no disagreements`
      }
      happened={t`${task.name} is an annotate task, so nothing is compared or scored.`}
      stillWorks={t`You can open the task to annotate its slides. Nothing was changed.`}
      actions={
        <Button
          variant="primary"
          onClick={() =>
            void navigate({ to: "/tasks/$taskId/guided", params: { taskId }, replace: true })
          }
        >
          <Trans>Open the task</Trans>
        </Button>
      }
    />
  );
}
