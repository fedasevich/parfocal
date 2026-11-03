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
          Needs review
        </StatusTag>
        <h3 className="m-0 mt-0.5 text-title leading-tight font-semibold">No tumor flagged</h3>
        <p className="m-0 text-body-sm leading-normal text-fg-dim">
          The AI found no tumor areas on this slide. Look at all the tissue at {scanMagnification}×,
          one field at a time in reading order, before you decide.
        </p>
      </div>
      <ProgressBar
        label="Tissue scanned"
        value={percent}
        valueText={`${percent}%`}
        tone={done ? "ok" : "accent"}
      />
      <div data-slot="scan-footer" className="flex items-center justify-between gap-2">
        {done ? (
          <>
            <span className="text-body-sm text-fg-dim">All {scan.fields} fields scanned.</span>
            <Button variant="primary" size="sm" onClick={onSubmit}>
              Submit
            </Button>
          </>
        ) : started ? (
          <>
            <span className="text-body-sm text-fg-dim tabular-nums">
              Field {scan.step} of {scan.fields}
            </span>
            <Button variant="primary" size="sm" onClick={onScan}>
              Next field
            </Button>
          </>
        ) : (
          <Button variant="primary" size="sm" onClick={onScan}>
            Start systematic scan
          </Button>
        )}
      </div>
    </div>
  );
}

export { NoTumorCard, type NoTumorCardProps };
