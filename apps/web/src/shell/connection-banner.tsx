import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { useEffect } from "react";
import { retryNow, useConnection, watchConnection } from "./connection.ts";

export function ConnectionBanner() {
  const { online, retrying } = useConnection();
  useEffect(() => watchConnection(window), []);
  if (online) return null;
  return (
    <Banner
      tone="warn"
      data-testid="connection-banner"
      actions={
        <Button size="sm" disabled={retrying} onClick={() => void retryNow()}>
          Retry now
        </Button>
      }
    >
      <b>Connection lost.</b> Saving is paused and nothing you typed is lost.{" "}
      {retrying ? "Trying again..." : "Retrying by itself."}
    </Banner>
  );
}
