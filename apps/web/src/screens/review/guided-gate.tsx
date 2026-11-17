import { Trans, useLingui } from "@lingui/react/macro";
import { ApiError, useGetFirstRead } from "@parfocal/api-client";
import { InlineState } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Loader } from "@parfocal/ui/components/loader";
import type { ReactNode } from "react";
import { FirstReadStep } from "./first-read.tsx";
import { type ReviewSession, useReviewSession } from "./review-data.ts";
import { ReviewOrderState } from "./review-order-state.tsx";

export function GuidedGate({
  taskId,
  slideId,
  children,
}: {
  taskId: string;
  slideId: string;
  children: (session: ReviewSession) => ReactNode;
}) {
  const { t } = useLingui();
  const session = useReviewSession(taskId, slideId);
  const hidesAi = session.task?.ai_hidden_first_read === true;
  const firstRead = useGetFirstRead(taskId, slideId, undefined, {
    query: { enabled: hidesAi, retry: false },
  });
  if (!session.ready && (session.order === "preparing" || session.order === "failed"))
    return <ReviewOrderState order={session.order} onRetry={session.retryOrder} />;
  if (!session.ready || (hidesAi && firstRead.isPending)) {
    return <Loader label={t`Loading the review`} size="page" />;
  }
  if (hidesAi && firstRead.isError) {
    const notRecorded = firstRead.error instanceof ApiError && firstRead.error.status === 404;
    if (notRecorded) return <FirstReadStep session={session} />;
    return (
      <main
        className="grid h-dvh place-items-center bg-page p-6 text-fg"
        data-ai="hidden"
        data-testid="first-read-unavailable"
      >
        <InlineState
          icon="warn"
          title={t`Your first read could not be checked`}
          action={
            <Button variant="ghost" onClick={() => void firstRead.refetch()}>
              <Trans>Try again</Trans>
            </Button>
          }
        >
          <Trans>
            The AI stays hidden until your first read is confirmed. Try again in a moment.
          </Trans>
        </InlineState>
      </main>
    );
  }
  return children(session);
}
