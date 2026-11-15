import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import { StatusTag } from "@parfocal/ui/components/tag";
import { type ScanSummary, scanMagnification } from "@parfocal/ui/lib/systematic-scan";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type NoTumorCardProps = React.ComponentProps<"div"> & {
  scan?: ScanSummary | null | undefined;
  onScan?: (() => void) | undefined;
  onSubmit?: (() => void) | undefined;
};

const percentOf = (share: number) => Math.round(share * 100);

function NoTumorCard({ scan = null, onScan, onSubmit, className, ...props }: NoTumorCardProps) {
  const { t } = useLingui();

  const started = scan !== null && scan.step > 0;
  const done = started && scan.step >= scan.fields;
  const percent = percentOf(scan?.coverage ?? 0);
  return (
    <div
      data-slot="no-tumor"
      data-scan={done ? "done" : started ? "scanning" : "idle"}
      data-coverage={percent}
      className={cn("grid gap-3", className)}
      {...props}
    >
      <div data-slot="staging-hero" className="grid gap-2">
        <StatusTag tone="warn" className="justify-self-start">
          <Trans>Needs review</Trans>
        </StatusTag>
        <h3 className="m-0 mt-0.5 text-title leading-tight font-semibold">
          <Trans>No tumor flagged</Trans>
        </h3>
        <p className="m-0 text-body-sm leading-normal text-fg-dim">
          <Trans>
            The AI found no tumor areas on this slide. Look at all the tissue at {scanMagnification}
            ×, one field at a time in reading order, before you decide.
          </Trans>
        </p>
      </div>
      <ProgressBar
        label={t`Tissue scanned`}
        value={percent}
        valueText={`${percent}%`}
        tone={done ? "ok" : "accent"}
      />
      <div data-slot="scan-footer" className="flex items-center justify-between gap-2">
        {done ? (
          <>
            <span className="text-body-sm text-fg-dim">
              <Trans>All {scan.fields} fields scanned.</Trans>
            </span>
            <Button variant="primary" size="sm" onClick={onSubmit}>
              <Trans>Submit</Trans>
            </Button>
          </>
        ) : started ? (
          <>
            <span className="text-body-sm text-fg-dim tabular-nums">
              <Trans>
                Field {scan.step} of {scan.fields}
              </Trans>
            </span>
            <Button variant="primary" size="sm" onClick={onScan}>
              <Trans>Next field</Trans>
            </Button>
          </>
        ) : (
          <Button variant="primary" size="sm" onClick={onScan}>
            <Trans>Start systematic scan</Trans>
          </Button>
        )}
      </div>
    </div>
  );
}

export { NoTumorCard, type NoTumorCardProps };
