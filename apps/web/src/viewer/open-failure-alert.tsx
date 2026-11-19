import { Trans } from "@lingui/react/macro";
import { InlineState } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { IntoTopStack } from "@parfocal/ui/components/top-stack";
import type { OpenFailure } from "./open-failure.ts";

export function OpenFailureAlert({
  failure,
  onRetry,
}: {
  failure: OpenFailure;
  onRetry: () => void;
}) {
  return (
    <IntoTopStack order="alert">
      <div className="w-[min(760px,100%)]">
        <InlineState
          icon="warn"
          title={failure.title}
          role="alert"
          className="border-solid shadow-pop"
          action={
            <Button size="lg" onClick={onRetry}>
              <Trans>Try again</Trans>
            </Button>
          }
        >
          {failure.detail}
        </InlineState>
      </div>
    </IntoTopStack>
  );
}
