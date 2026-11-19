import { Trans, useLingui } from "@lingui/react/macro";
import { InlineState } from "@parfocal/ui/components/banner";
import { Button, buttonVariants } from "@parfocal/ui/components/button";
import { Loader } from "@parfocal/ui/components/loader";
import { Link } from "@tanstack/react-router";
import { waitedMinutes } from "./review-order-state.ts";

type ReviewOrderStateProps = {
  readonly order: "preparing" | "failed";
  readonly onRetry: () => void;
  readonly projectId?: string | undefined;
  readonly madeAt?: string | undefined;
};

function BackLink({ projectId }: { readonly projectId?: string | undefined }) {
  const className = buttonVariants({ variant: "ghost" });
  if (projectId)
    return (
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        className={className}
        data-testid="review-order-back"
      >
        <Trans>Back to the project</Trans>
      </Link>
    );
  return (
    <Link to="/my-work" className={className} data-testid="review-order-back">
      <Trans>Back to my work</Trans>
    </Link>
  );
}

function WaitLine({ madeAt }: { readonly madeAt?: string | undefined }) {
  const minutes = waitedMinutes(madeAt, Date.now());
  if (minutes < 1) return null;
  return (
    <p className="text-body-sm text-fg-dim" data-testid="review-order-waited">
      {minutes >= 5 ? (
        <Trans>
          The task was made {minutes} minutes ago. This is taking longer than usual, so you can go
          back and open it later.
        </Trans>
      ) : (
        <Trans>The task was made {minutes} minutes ago.</Trans>
      )}
    </p>
  );
}

export function ReviewOrderState({ order, onRetry, projectId, madeAt }: ReviewOrderStateProps) {
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
              The objects are being put in review order. This usually takes under a minute, and this
              page checks again every few seconds.
            </Trans>
          </p>
          <WaitLine madeAt={madeAt} />
          <div className="flex items-center gap-2">
            <BackLink projectId={projectId} />
            <Button variant="ghost" onClick={onRetry} data-testid="review-order-retry">
              <Trans>Check now</Trans>
            </Button>
          </div>
        </div>
      </main>
    );
  }
  return (
    <main
      className="grid h-dvh place-items-center bg-page p-6 text-fg"
      data-testid="review-order-failed"
    >
      <InlineState
        icon="warn"
        title={t`This slide could not be prepared`}
        action={
          <div className="flex items-center gap-2">
            <BackLink projectId={projectId} />
            <Button variant="ghost" onClick={onRetry} data-testid="review-order-retry">
              <Trans>Try again</Trans>
            </Button>
          </div>
        }
      >
        <Trans>
          The review order of this slide could not be worked out. Try again in a moment.
        </Trans>
      </InlineState>
    </main>
  );
}

export function ReviewOrderTabNotice({
  order,
  onRetry,
}: {
  readonly order: "preparing" | "failed";
  readonly onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2" data-testid={`review-order-tab-${order}`}>
      <p className="m-0 text-body-sm leading-[1.5] text-fg-dim">
        {order === "preparing" ? (
          <Trans>
            The objects of this slide are still being put in review order. They appear here on their
            own once it is ready.
          </Trans>
        ) : (
          <Trans>The review order of this slide could not be worked out.</Trans>
        )}
      </p>
      <Button variant="ghost" onClick={onRetry}>
        {order === "preparing" ? <Trans>Check now</Trans> : <Trans>Try again</Trans>}
      </Button>
    </div>
  );
}

export function ReviewOrderOpinionNotice() {
  return (
    <p
      className="m-0 p-4 text-body-sm leading-[1.5] text-fg-dim"
      data-testid="review-order-opinion-closed"
    >
      <Trans>The opinion opens once the objects of this slide are prepared and answered.</Trans>
    </p>
  );
}
