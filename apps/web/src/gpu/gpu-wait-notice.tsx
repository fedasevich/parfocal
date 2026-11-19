import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { IntoTopStack, useTopStacked } from "@parfocal/ui/components/top-stack";
import { cn } from "@parfocal/ui/lib/utils";
import { useEffect, useSyncExternalStore } from "react";
import { type GpuWait, gpuWaits, holdGpuWait, holdGpuWaitEvent } from "./gpu-wait.ts";

function longestWait(waits: readonly GpuWait[]): number {
  return Math.round(Math.max(0, ...waits.map((wait) => wait.waitedSeconds)));
}

export function GpuWaitNotice() {
  const { t } = useLingui();
  const waits = useSyncExternalStore(gpuWaits.subscribe, gpuWaits.current);
  const stacked = useTopStacked();
  useEffect(() => {
    if (import.meta.env.PARFOCAL_PUBLIC_DEV_TOOLS !== "on") return;
    const hold = (event: Event) => holdGpuWait(Number((event as CustomEvent<number>).detail));
    window.addEventListener(holdGpuWaitEvent, hold);
    return () => window.removeEventListener(holdGpuWaitEvent, hold);
  }, []);
  if (waits.length === 0) return null;
  const seconds = longestWait(waits);
  const kinds = [...new Set(waits.map((wait) => wait.kind))].sort().join(" ");
  return (
    <IntoTopStack order="wait">
      <div
        role="status"
        aria-label={t`Waiting for a GPU`}
        data-testid="gpu-wait"
        data-kinds={kinds}
        className={cn(
          "pointer-events-auto flex items-center gap-3 rounded-md border border-line bg-chrome px-3 py-2 text-caption shadow-sm",
          stacked ? "" : "absolute top-3 left-1/2 z-20 -translate-x-1/2",
        )}
      >
        <span>
          <Trans>Waiting for a GPU</Trans>
        </span>
        <span className="text-fg-dim tabular-nums" data-testid="gpu-wait-seconds">
          <Trans>{seconds} s</Trans>
        </span>
        <Button
          size="sm"
          variant="secondary"
          data-testid="gpu-wait-cancel"
          title={t`Stops waiting and asks the GPU for nothing more`}
          onClick={() => gpuWaits.cancelAll()}
        >
          <Trans>Cancel</Trans>
        </Button>
      </div>
    </IntoTopStack>
  );
}
