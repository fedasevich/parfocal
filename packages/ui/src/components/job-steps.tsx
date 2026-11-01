import { Icon } from "@parfocal/ui/components/icon";
import { ProgressBar, type ProgressTone } from "@parfocal/ui/components/progress-meter";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type JobStepState = "done" | "current" | "held" | "waiting";

type JobStep = {
  label: string;
  detail?: string | undefined;
  state: JobStepState;
  percent?: number | undefined;
  valueText?: React.ReactNode;
};

function StepMark({ state }: { state: JobStepState }) {
  if (state === "done") return <Icon name="check" className="text-ok" />;
  if (state === "held") return <Icon name="pause" className="text-warn" />;
  if (state === "current") {
    return (
      <i className="size-3.25 animate-spin justify-self-center rounded-full border-2 border-[color-mix(in_srgb,var(--accent)_25%,transparent)] border-t-accent" />
    );
  }
  return (
    <i className="size-3.25 justify-self-center rounded-full border-[1.5px] border-line-strong" />
  );
}

type JobStepListProps = React.ComponentProps<"div"> & {
  steps: JobStep[];
  footer?: React.ReactNode;
};

function JobStepList({ steps, footer, className, ...props }: JobStepListProps) {
  return (
    <div
      data-slot="job-step-list"
      className={cn("grid gap-1.75 pt-1 pr-3.5 pb-3.5 pl-16.5", className)}
      {...props}
    >
      {steps.map((step) => {
        const shown = step.state !== "waiting";
        const bar = step.state === "current" || step.state === "held";
        return (
          <div
            key={step.label}
            data-state={step.state}
            className={cn(
              "grid min-h-5.5 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 text-body-sm",
              step.state === "done" || step.state === "current" ? "text-fg" : "text-fg-faint",
              step.state === "held" && "text-fg",
            )}
          >
            <StepMark state={step.state} />
            <span>
              {step.label}
              {step.detail && shown ? (
                <small className="ml-2 text-caption text-fg-dim">{step.detail}</small>
              ) : null}
            </span>
            {bar ? (
              <span className="flex w-57.5 items-center gap-2.5">
                <ProgressBar
                  value={step.percent ?? 0}
                  tone={step.state === "held" ? "warn" : "accent"}
                  aria-label={step.label}
                  className="flex-1"
                />
                <span className="text-caption font-medium whitespace-nowrap text-fg tabular-nums">
                  {step.valueText ?? `${step.percent ?? 0}%`}
                </span>
              </span>
            ) : (
              <span />
            )}
          </div>
        );
      })}
      {footer ? <div className="pt-1">{footer}</div> : null}
    </div>
  );
}

type JobSlideRowProps = Omit<React.ComponentProps<"div">, "title"> & {
  name: string;
  percent: number;
  valueText: React.ReactNode;
  tone?: ProgressTone;
  thumbnail?: string | undefined;
  stepsDone: number;
  stepsTotal: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: React.ReactNode;
};

function JobSlideRow({
  name,
  percent,
  valueText,
  tone = "accent",
  thumbnail,
  stepsDone,
  stepsTotal,
  open,
  onOpenChange,
  className,
  children,
  ...props
}: JobSlideRowProps) {
  return (
    <div
      data-slot="job-slide-row"
      data-open={open || undefined}
      className={cn(
        "border-b border-line last:border-b-0",
        open && "bg-[color-mix(in_srgb,var(--fg)_3%,transparent)]",
        className,
      )}
      {...props}
    >
      <div className="grid min-h-14 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3.5 py-1.5 pr-3.5 pl-3">
        <i
          aria-hidden="true"
          className="h-7 w-10 flex-none rounded-sm border border-line bg-chrome-3 bg-cover bg-center"
          style={thumbnail ? { backgroundImage: `url(${thumbnail})` } : undefined}
        />
        <ProgressBar
          value={percent}
          tone={tone}
          label={<b className="font-mono font-medium text-fg">{name}</b>}
          valueText={valueText}
          aria-label={name}
        />
        <button
          type="button"
          aria-expanded={open}
          title={open ? "Hide the steps" : "Show the steps"}
          onClick={() => onOpenChange(!open)}
          className="inline-flex h-6.5 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-transparent px-2 text-caption text-fg-dim hover:border-line-strong hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className="tabular-nums">
            {stepsDone} of {stepsTotal}
          </span>
          <Icon name="down" className={cn("transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open ? children : null}
    </div>
  );
}

function JobSlideList({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="job-slide-list"
      className={cn(
        "grid min-w-0 overflow-hidden rounded-[10px] border border-surf-edge bg-surf-panel",
        className,
      )}
      {...props}
    />
  );
}

export {
  JobSlideList,
  JobSlideRow,
  type JobSlideRowProps,
  type JobStep,
  JobStepList,
  type JobStepListProps,
  type JobStepState,
};
