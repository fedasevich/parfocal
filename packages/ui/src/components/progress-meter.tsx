import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { Icon } from "@parfocal/ui/components/icon";
import {
  type Decision,
  type DecisionSplit,
  donePercent,
  ringArcs,
  stackedParts,
} from "@parfocal/ui/lib/decision-split";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type ProgressTone = "accent" | "ok" | "warn" | "bad" | "tiles";

const fillTones: Record<ProgressTone, string> = {
  accent: "bg-accent-fill",
  ok: "bg-ok-fill",
  warn: "bg-v-unsure",
  bad: "bg-bad-fill",
  tiles:
    "bg-[repeating-linear-gradient(-45deg,var(--accent-fill)_0_6px,color-mix(in_srgb,var(--accent-fill)_60%,transparent)_6px_12px)]",
};

type ProgressBarProps = Omit<ProgressPrimitive.Root.Props, "children"> & {
  label?: React.ReactNode;
  valueText?: React.ReactNode;
  tone?: ProgressTone;
};

function ProgressBar({
  label,
  valueText,
  tone = "accent",
  value,
  max = 100,
  className,
  ...props
}: ProgressBarProps) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress-bar"
      value={value}
      max={max}
      getAriaValueText={
        typeof valueText === "string" && value !== null ? () => valueText : undefined
      }
      className={cn("grid min-w-0 gap-1.5", className)}
      {...props}
    >
      {label || valueText ? (
        <span className="flex min-w-0 items-baseline justify-between gap-2.5 text-caption leading-tight text-fg-dim">
          <ProgressPrimitive.Label className="min-w-0 truncate">{label}</ProgressPrimitive.Label>
          <span className="shrink-0 font-medium whitespace-nowrap text-fg tabular-nums">
            {valueText}
          </span>
        </span>
      ) : null}
      <ProgressPrimitive.Track className="block h-1.5 overflow-hidden rounded-[3px] bg-track">
        <ProgressPrimitive.Indicator
          className={cn("block h-full rounded-[3px] transition-all", fillTones[tone])}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

const decisionStroke: Record<Decision, string> = {
  agree: "var(--v-agree)",
  disagree: "var(--v-disagree)",
  unsure: "var(--v-unsure)",
  open: "var(--v-open)",
};

type ProgressRingProps = Omit<React.ComponentProps<"span">, "children"> & {
  split: DecisionSplit;
  size?: number;
  label?: string;
};

function ProgressRing({ split, size = 40, label, className, ...props }: ProgressRingProps) {
  const stroke = Math.max(3, Math.round(size / 10));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const percent = donePercent(split);
  const arcs = ringArcs(split, circumference);
  return (
    <span
      data-slot="progress-ring"
      role="img"
      aria-label={
        label ??
        `${percent}% done: ${split.agree} agree, ${split.disagree} disagree, ${split.unsure} not sure, ${split.open} open`
      }
      className={cn("relative inline-grid shrink-0 place-items-center align-middle", className)}
      style={{ width: size, height: size }}
      {...props}
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 size-full -rotate-90"
        viewBox={`0 0 ${size} ${size}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--v-open)"
          strokeWidth={stroke}
        />
        {arcs.map((arc) => (
          <circle
            key={arc.decision}
            data-decision={arc.decision}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={decisionStroke[arc.decision]}
            strokeWidth={stroke}
            strokeDasharray={`${arc.length} ${circumference - arc.length}`}
            strokeDashoffset={-arc.offset}
          />
        ))}
      </svg>
      {percent === 100 ? (
        <Icon name="check" size={size >= 56 ? "md" : "sm"} className="relative text-ok" />
      ) : (
        <b
          aria-hidden="true"
          className="relative font-mono leading-none font-semibold tracking-tight text-fg"
          style={{ fontSize: size >= 56 ? 14 : 11 }}
        >
          {percent}%
        </b>
      )}
    </span>
  );
}

type StackedBarProps = Omit<React.ComponentProps<"div">, "children"> & {
  split: Omit<DecisionSplit, "open">;
  emptyText?: string;
};

const stackedFill = { agree: "bg-v-agree", unsure: "bg-v-unsure", disagree: "bg-v-disagree" };

const stackedWords = { agree: "agree", unsure: "not sure", disagree: "disagree" };

function StackedBar({ split, emptyText = "No answers yet", className, ...props }: StackedBarProps) {
  const parts = stackedParts(split);
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  return (
    <div data-slot="stacked-bar" className={cn("grid gap-1.5", className)} {...props}>
      <div
        role="img"
        aria-label={
          total === 0
            ? emptyText
            : parts.map((part) => `${part.count} ${stackedWords[part.decision]}`).join(", ")
        }
        className="flex h-2 overflow-hidden rounded-full bg-track"
      >
        {parts.map((part) =>
          part.share > 0 ? (
            <span
              key={part.decision}
              data-decision={part.decision}
              className={stackedFill[part.decision]}
              style={{ width: `${part.share * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <span className="text-caption text-fg-dim">
        {total === 0
          ? emptyText
          : parts.map((part) => `${part.count} ${stackedWords[part.decision]}`).join(" · ")}
      </span>
    </div>
  );
}

export {
  type DecisionSplit,
  ProgressBar,
  type ProgressBarProps,
  ProgressRing,
  type ProgressRingProps,
  type ProgressTone,
  StackedBar,
  type StackedBarProps,
};
