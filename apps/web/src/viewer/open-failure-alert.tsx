import { Trans } from "@lingui/react/macro";
import { InlineState } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { IntoTopStack } from "@parfocal/ui/components/top-stack";
import { useEffect } from "react";
import type { OpenFailure } from "./open-failure.ts";
import { useStageOpenState } from "./stage-open-state.tsx";

export function OpenFailureAlert({
  failure,
  onRetry,
}: {
  failure: OpenFailure;
  onRetry: () => void;
}) {
  const { onFailed } = useStageOpenState();
  useEffect(() => {
    onFailed(true);
    return () => onFailed(false);
  }, [onFailed]);
  return (
    <IntoTopStack order="alert">
      <div className="w-[min(760px,100%)]">
        <InlineState
          icon="warn"
          title={failure.title}
          role="alert"
          className="border-solid shadow-pop"
          action={
            failure.retry ? (
              <Button size="lg" onClick={onRetry}>
                <Trans>Try again</Trans>
              </Button>
            ) : undefined
          }
        >
          {failure.detail}
        </InlineState>
      </div>
    </IntoTopStack>
  );
}
