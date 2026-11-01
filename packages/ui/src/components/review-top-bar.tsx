import type { LinkRenderer } from "@parfocal/ui/components/app-shell";
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
  slideThumb?: string | undefined;
  progress?: DecisionSplit | undefined;
  progressTitle: string;
  progressSub: string;
  primaryLabel?: string;
  primaryDisabledReason?: string | undefined;
  primaryTitle?: string | undefined;
  onPrimary?: (() => void) | undefined;
  onModeChange?: (mode: "guided" | "full") => void;
  backHref?: string | undefined;
  backLabel?: string;
  renderLink?: LinkRenderer | undefined;
  accountSlot?: React.ReactNode;
};

const anchorLink: LinkRenderer = ({ children, ...props }) => <a {...props}>{children}</a>;

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
  primaryTitle,
  onPrimary,
  onModeChange,
  backHref,
  backLabel = "My work",
  renderLink = anchorLink,
  accountSlot,
  className,
  ...props
}: ReviewTopBarProps) {
  const big = mode !== "full";
  const thumb = (
    <span
      aria-hidden="true"
      className="h-4.5 w-6.5 shrink-0 rounded-[3px] bg-[#f1eef2] bg-cover bg-center"
      style={slideThumb ? { backgroundImage: `url(${slideThumb})` } : undefined}
    />
  );
  const backBody = (
    <>
      <Icon name="back" />
      <span>{backLabel}</span>
    </>
  );
  const backClass =
    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-ctl px-2 text-body-sm font-medium text-fg-dim no-underline outline-none hover:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] hover:text-fg focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <header
      data-slot="review-top-bar"
      data-mode={mode}
      className={cn(
        "flex shrink-0 items-center gap-3 border-b border-line bg-chrome px-3 text-body-sm",
        big ? "h-16 px-4" : "h-11",
        className,
      )}
      {...props}
    >
      {backHref
        ? renderLink({
            href: backHref,
            className: backClass,
            title: "Back to My work. Every answer is saved",
            children: backBody,
          })
        : null}
      <span aria-hidden="true" className="h-6 w-px shrink-0 bg-line" />
      <div className="grid min-w-0 leading-tight">
        <b className="truncate text-body-sm font-semibold">{taskName}</b>
        <small className="truncate text-caption text-fg-dim">{taskSub}</small>
      </div>
      {big ? (
        <span
          className="inline-flex h-8 shrink-0 items-center gap-2 px-2"
          title="Submit opens the next slide"
        >
          {thumb}
          <b className="text-body-sm font-semibold">{slideName}</b>
        </span>
      ) : (
        <button
          type="button"
          aria-haspopup="dialog"
          title="Slides in this case and task, with their result sets (Q and E step through them)"
          className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-ctl border border-line-strong bg-btn-bg px-2 text-fg"
        >
          {thumb}
          <b className="text-body-sm font-semibold">{slideName}</b>
          <Icon name="down" className="text-fg-faint" />
        </button>
      )}
      <span
        className="inline-flex shrink-0 items-center gap-2.5"
        title="Progress on this slide and in the whole task"
      >
        {progress ? <ProgressRing split={progress} size={big ? 40 : 34} /> : null}
        <span className="grid leading-tight">
          <b className="text-body-sm font-semibold">{progressTitle}</b>
          <small className="text-caption text-fg-dim">{progressSub}</small>
        </span>
        {progress && mode !== "adjudicate" ? <Icon name="down" className="text-fg-faint" /> : null}
      </span>
      <span className="flex-1" />
      {mode === "adjudicate" ? null : (
        <SegmentedControl
          aria-label="How to review"
          value={mode}
          onValueChange={(value) => onModeChange?.(value as "guided" | "full")}
          size={big ? "lg" : "md"}
          options={[
            { value: "guided", label: "Guided" },
            { value: "full", label: "Full viewer" },
          ]}
        />
      )}
      <Button
        variant="primary"
        size={big ? "lg" : "default"}
        disabled={Boolean(primaryDisabledReason)}
        title={primaryDisabledReason ?? primaryTitle}
        onClick={onPrimary}
      >
        {mode === "adjudicate" ? "Done for now" : primaryLabel}
      </Button>
      {accountSlot}
    </header>
  );
}

export { type ReviewMode, ReviewTopBar, type ReviewTopBarProps };
