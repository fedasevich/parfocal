import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { retryNow, useConnection } from "./connection.ts";
import { showUndoToast } from "./undo-toasts.tsx";

export function ConnectionBanner({ pinned = false }: { pinned?: boolean }) {
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
          onClick={() => (online ? showUndoToast({ message: "Still offline" }) : void retryNow())}
        >
          Retry now
        </Button>
      }
    >
      <b>Connection lost.</b> Saving is paused and nothing you typed is lost.{" "}
      {retrying ? "Trying again..." : "Retrying by itself."}
    </Banner>
  );
}
