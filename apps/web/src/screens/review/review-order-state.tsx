import { Trans, useLingui } from "@lingui/react/macro";
import { InlineState } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Loader } from "@parfocal/ui/components/loader";

type ReviewOrderStateProps = {
  readonly order: "preparing" | "failed";
  readonly onRetry: () => void;
};

export function ReviewOrderState({ order, onRetry }: ReviewOrderStateProps) {
  const { t } = useLingui();
  if (order === "preparing") {
    return (
      <main
        className="grid h-dvh place-items-center bg-page p-6 text-fg"
        data-testid="review-order-preparing"
      >
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <Loader label={t`Preparing this slide`} />
          <p className="font-semibold text-fg">
            <Trans>Preparing this slide</Trans>
          </p>
          <p className="text-body text-fg-dim">
            <Trans>
              The objects are being put in review order. This usually takes under a minute.
            </Trans>
          </p>
        </div>
      </main>
    );
  }
  if (order === "failed") {
    return (
      <main
        className="grid h-dvh place-items-center bg-page p-6 text-fg"
        data-testid="review-order-failed"
      >
        <InlineState
          icon="warn"
          title={t`This slide could not be prepared`}
          action={
            <Button variant="ghost" onClick={onRetry}>
              <Trans>Try again</Trans>
            </Button>
          }
        >
          <Trans>
            The review order of this slide could not be worked out. Try again in a moment.
          </Trans>
        </InlineState>
      </main>
    );
  }
  return null;
}
