import { Trans, useLingui } from "@lingui/react/macro";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { retryNow, useConnection } from "./connection.ts";
import { showUndoToast } from "./undo-toasts.tsx";

export function ConnectionBanner({ pinned = false }: { pinned?: boolean }) {
  const { t } = useLingui();

  const { online, retrying } = useConnection();
  if (online && !pinned) return null;
  return (
    <Banner
      tone="warn"
      data-testid="connection-banner"
      actions={
        <Button
          size="sm"
          disabled={retrying}
          onClick={() => (online ? showUndoToast({ message: t`Still offline` }) : void retryNow())}
        >
          <Trans>Retry now</Trans>
        </Button>
      }
    >
      <Trans>
        <b>Connection lost.</b> Saving is paused and nothing you typed is lost.{" "}
      </Trans>
      {retrying ? t`Trying again...` : t`Retrying by itself.`}
    </Banner>
  );
}
