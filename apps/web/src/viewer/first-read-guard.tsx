import { useLingui } from "@lingui/react/macro";
import { useGetReviewTask } from "@parfocal/api-client";
import { Loader } from "@parfocal/ui/components/loader";
import { type ReactNode, useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { GuidedGate } from "../screens/review/guided-gate.tsx";

export function FirstReadGuard({
  taskId,
  slideId,
  children,
}: {
  taskId: string | undefined;
  slideId: string;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const task = useGetReviewTask(taskId ?? "", { query: { enabled: taskId !== undefined } });
  const [settled, setSettled] = useState<string | null>(null);
  if (task.isError && settled !== taskId && taskId !== undefined) setSettled(taskId);
  if (taskId === undefined) return children;
  if (task.isPending && settled !== taskId)
    return <Loader label={t`Loading the review`} size="page" />;
  if (okData(task.data)?.ai_hidden_first_read !== true) return children;
  return (
    <GuidedGate taskId={taskId} slideId={slideId}>
      {() => children}
    </GuidedGate>
  );
}
