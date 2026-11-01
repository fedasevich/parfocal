import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { type DecisionSplit, ProgressRing } from "@parfocal/ui/components/progress-meter";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type ReviewMode = "guided" | "full" | "adjudicate";

type ReviewTopBarProps = React.ComponentProps<"header"> & {
  mode?: ReviewMode;
  taskName: string;
  taskSub: string;
  slideName: string;
  slideThumb?: string;
  progress: DecisionSplit;
  progressTitle: string;
  progressSub: string;
  primaryLabel?: string;
  primaryDisabledReason?: string;
  onModeChange?: (mode: "guided" | "full") => void;
};

function ReviewTopBar({
  mode = "guided",
  taskName,
  taskSub,
  slideName,
  slideThumb,
  progress,
  progressTitle,
  progressSub,
  primaryLabel = "Submit",
  primaryDisabledReason,
  onModeChange,
  className,
  ...props
}: ReviewTopBarProps) {
  const big = mode !== "full";
  return (
    <header
      data-slot="review-top-bar"
      data-mode={mode}
      className={cn(
        "flex items-center gap-3 border-b border-line bg-chrome px-3 text-body-sm",
        big ? "h-16" : "h-11",
        className,
      )}
      {...props}
    >
      <Button variant="ghost" title="Back to My work. Every answer is saved">
        <Icon name="back" />
        My work
      </Button>
      <span aria-hidden="true" className="h-6 w-px bg-line" />
      <div className="grid min-w-0 leading-tight">
        <b className="truncate text-body-sm font-semibold">{taskName}</b>
        <small className="truncate text-caption text-fg-faint">{taskSub}</small>
      </div>
      <span className="inline-flex h-8 items-center gap-2 rounded-ctl border border-line px-2">
        <span
          aria-hidden="true"
          className="h-4.5 w-6.5 rounded-[3px] bg-[#f1eef2] bg-cover bg-center"
          style={slideThumb ? { backgroundImage: `url(${slideThumb})` } : undefined}
        />
        <b className="text-body-sm font-semibold">{slideName}</b>
      </span>
      <span className="inline-flex items-center gap-2.5">
        <ProgressRing split={progress} size={big ? 40 : 34} />
        <span className="grid leading-tight">
          <b className="text-body-sm font-semibold">{progressTitle}</b>
          <small className="text-caption text-fg-faint">{progressSub}</small>
        </span>
      </span>
      <span className="flex-1" />
      {mode === "adjudicate" ? null : (
        <SegmentedControl
          aria-label="How to review"
          value={mode}
          onValueChange={(value) => onModeChange?.(value as "guided" | "full")}
          options={[
            { value: "guided", label: "Guided" },
            { value: "full", label: "Full viewer" },
          ]}
        />
      )}
      <Button
        variant="primary"
        disabled={Boolean(primaryDisabledReason)}
        title={primaryDisabledReason}
      >
        {mode === "adjudicate" ? "Done for now" : primaryLabel}
      </Button>
    </header>
  );
}

export { type ReviewMode, ReviewTopBar, type ReviewTopBarProps };
