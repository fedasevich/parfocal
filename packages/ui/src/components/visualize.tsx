import { Button } from "@parfocal/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@parfocal/ui/components/dropdown-menu";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Switch } from "@parfocal/ui/components/switch";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type VizLegendProps = Omit<React.ComponentProps<"div">, "title"> & {
  kind: string;
  title: React.ReactNode;
  note?: React.ReactNode;
};

function VizLegend({ kind, title, note, className, children, ...props }: VizLegendProps) {
  return (
    <div
      data-slot="viz-legend"
      className={cn(
        "grid w-65 gap-2.5 rounded-zone border border-line bg-surf-panel p-4 text-body-sm text-fg shadow-pop",
        className,
      )}
      {...props}
    >
      <div className="grid gap-0.5">
        <span className="text-caption font-semibold text-fg-dim">{kind}</span>
        <b className="font-semibold">{title}</b>
      </div>
      {children}
      {note ? (
        <p className="m-0 border-t border-line pt-2.5 leading-[1.45] text-fg-dim">{note}</p>
      ) : null}
    </div>
  );
}

type VizKeyProps = React.ComponentProps<"div"> & {
  color: string;
  label: React.ReactNode;
  count?: number | undefined;
};

function VizKey({ color, label, count, className, ...props }: VizKeyProps) {
  return (
    <div
      data-slot="viz-key"
      className={cn("flex items-center gap-2.5 text-fg-dim", className)}
      {...props}
    >
      <i
        aria-hidden="true"
        className="size-3 shrink-0 rounded-[3px]"
        style={{ background: color }}
      />
      <span className="flex-1">{label}</span>
      {count === undefined ? null : <b className="font-mono font-semibold text-fg">{count}</b>}
    </div>
  );
}

const ramps = {
  heat: "linear-gradient(90deg, rgb(239 68 68 / 0), rgb(239 68 68 / 0.45), #dc2626)",
  density: "linear-gradient(90deg, #7c3aed, #f97316, #facc15)",
} as const;

type VizRampProps = React.ComponentProps<"div"> & {
  ramp: keyof typeof ramps;
  labels: [string, string, string];
};

function VizRamp({ ramp, labels, className, ...props }: VizRampProps) {
  return (
    <div data-slot="viz-ramp" className={cn("grid gap-1", className)} {...props}>
      <div aria-hidden="true" className="h-2.5 rounded-full" style={{ background: ramps[ramp] }} />
      <div className="flex justify-between font-mono text-caption text-fg-dim">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}

type SetChipProps = React.ComponentProps<"div"> & { color: string };

function SetChip({ color, className, children, ...props }: SetChipProps) {
  return (
    <div
      data-slot="set-chip"
      className={cn(
        "inline-flex items-center gap-2 rounded-ctl border border-line bg-surf-panel px-3 py-1.5 text-body-sm font-medium text-fg shadow-pop",
        className,
      )}
      {...props}
    >
      <i aria-hidden="true" className="size-3 rounded-[3px]" style={{ background: color }} />
      {children}
    </div>
  );
}

type SwipeHandleProps = React.ComponentProps<"div"> & { label?: string };

function SwipeHandle({
  label = "Drag to swipe between the two sets",
  className,
  ...props
}: SwipeHandleProps) {
  return (
    <div
      data-slot="swipe-handle"
      className={cn("pointer-events-none absolute inset-y-0 w-0.5 bg-white", className)}
      {...props}
    >
      <span
        role="img"
        aria-label={label}
        className="absolute top-1/2 left-1/2 grid h-9 w-9 -translate-1/2 grid-flow-col place-items-center rounded-full bg-white text-[#1d1d1d] shadow-pop"
      >
        <Icon name="back" size="xs" />
        <Icon name="next" size="xs" />
      </span>
    </div>
  );
}

type ViewOption = { value: string; label: string };

type ViewPickerProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  views: ViewOption[];
  value: string;
  onValueChange?: (value: string) => void;
};

function ViewPicker({ views, value, onValueChange, className, ...props }: ViewPickerProps) {
  return (
    <div
      data-slot="view-picker"
      role="radiogroup"
      aria-label="Ways to show results"
      className={cn("grid gap-0.5", className)}
      {...props}
    >
      {views.map((view) => {
        const on = view.value === value;
        return (
          <button
            key={view.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onValueChange?.(view.value)}
            className={cn(
              "flex h-8.5 cursor-pointer items-center justify-between rounded-ctl border border-transparent bg-transparent px-2 text-left text-body-sm text-fg-dim hover:bg-chrome-2 hover:text-fg",
              on && "border-accent bg-accent-soft font-semibold text-fg",
            )}
          >
            {view.label}
            {on ? <Icon name="check" size="sm" className="text-accent" /> : null}
          </button>
        );
      })}
    </div>
  );
}

type ResultSetRowItem = {
  key: string;
  name: string;
  sub: string;
  color: string;
  fixed?: boolean;
  on?: boolean;
  menu?: { icon: IconName; label: string; onSelect?: () => void }[];
};

type ResultSetRowsProps = Omit<React.ComponentProps<"div">, "onToggle"> & {
  sets: ResultSetRowItem[];
  locked?: { reason: string } | undefined;
  onToggle?: (key: string, on: boolean) => void;
};

function ResultSetRows({ sets, locked, onToggle, className, ...props }: ResultSetRowsProps) {
  return (
    <div
      data-slot="result-set-rows"
      data-locked={locked ? true : undefined}
      className={cn("grid gap-1.5", className)}
      {...props}
    >
      {locked ? (
        <p className="m-0 flex items-start gap-1.5 text-caption text-fg-dim">
          <Icon name="lock" size="xs" className="mt-0.5 shrink-0" />
          <span>{locked.reason}</span>
        </p>
      ) : null}
      {sets.map((set) => {
        const body = (
          <>
            <i
              aria-hidden="true"
              className="size-3 shrink-0 rounded-[3px]"
              style={{ background: set.color }}
            />
            <span className="grid min-w-0 flex-1">
              <b className="truncate text-body-sm font-semibold text-fg">{set.name}</b>
              <small className="text-caption text-fg-dim">{set.sub}</small>
            </span>
          </>
        );
        return (
          <div key={set.key} className="flex items-center gap-1.5">
            {set.fixed ? (
              <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1 py-1">{body}</div>
            ) : locked && set.key !== "reviewed" ? (
              <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1 py-1">
                {body}
                <span className="text-caption text-fg-dim">{set.on ? "Shown" : "Hidden"}</span>
              </div>
            ) : (
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-1 py-1">
                {body}
                <Switch
                  aria-label={set.name}
                  {...(onToggle
                    ? { checked: set.on ?? false }
                    : { defaultChecked: set.on ?? false })}
                  onCheckedChange={(on) => onToggle?.(set.key, on)}
                />
              </label>
            )}
            {set.menu?.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`More for ${set.name}`}
                      title="Compare, run again or add another"
                    />
                  }
                >
                  <Icon name="more" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  {set.menu.map((item) => (
                    <DropdownMenuItem key={item.label} onClick={item.onSelect}>
                      <Icon name={item.icon} />
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

type ScoreHistogramProps = React.ComponentProps<"div"> & {
  bins: number[];
  cutoff: number;
};

function ScoreHistogram({ bins, cutoff, className, ...props }: ScoreHistogramProps) {
  const top = Math.max(1, ...bins);
  return (
    <div data-slot="score-histogram" className={cn("grid gap-1.5", className)} {...props}>
      <div
        role="img"
        aria-label={`Scores in ${bins.length} bins from 0 to 1, cutoff ${cutoff.toFixed(2)}`}
        className="flex h-16 items-end gap-1"
      >
        {bins.map((count, index) => (
          <i
            key={index}
            className={cn(
              "flex-1 rounded-t-[2px]",
              (index + 0.5) / bins.length < cutoff ? "bg-fg-faint" : "bg-accent-fill",
            )}
            style={{ height: `${Math.max(2, (count / top) * 100)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-caption text-fg-dim">
        <span>0</span>
        <span>{cutoff.toFixed(2)} cutoff</span>
        <span>1</span>
      </div>
    </div>
  );
}

type ClassCountsProps = React.ComponentProps<"div"> & {
  rows: { name: string; color: string; count: number }[];
};

function ClassCounts({ rows, className, ...props }: ClassCountsProps) {
  return (
    <div
      data-slot="class-counts"
      className={cn("grid grid-cols-2 gap-x-6 gap-y-1.5 text-body-sm", className)}
      {...props}
    >
      {rows.map((row) => (
        <div key={row.name} className="flex items-center gap-2">
          <i
            aria-hidden="true"
            className="size-2.5 rounded-[3px]"
            style={{ background: row.color }}
          />
          <span className="flex-1">{row.name}</span>
          <b className="font-mono font-semibold">{row.count.toLocaleString("en-US")}</b>
        </div>
      ))}
    </div>
  );
}

type AiStep = {
  icon: IconName;
  label: string;
  value: string;
  state: "done" | "running" | "queued";
  percent?: number;
};

type AiRunningStepsProps = React.ComponentProps<"div"> & { steps: AiStep[] };

function AiRunningSteps({ steps, className, ...props }: AiRunningStepsProps) {
  return (
    <div data-slot="ai-running-steps" className={cn("grid gap-2.5", className)} {...props}>
      {steps.map((step) => (
        <div key={step.label} className="grid gap-1.5">
          <div className="flex items-center gap-2.5 text-body-sm">
            <Icon
              name={step.icon}
              size="sm"
              className={cn(
                step.state === "done" && "text-ok",
                step.state === "running" && "text-accent",
                step.state === "queued" && "text-fg-faint",
              )}
            />
            <span className={cn("flex-1", step.state === "queued" && "text-fg-dim")}>
              {step.label}
            </span>
            <span className="font-mono text-fg-dim">{step.value}</span>
          </div>
          {step.state === "running" && step.percent !== undefined ? (
            <div
              role="progressbar"
              aria-label={step.label}
              aria-valuenow={step.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="ml-6.5 h-1 overflow-hidden rounded-full bg-chrome-2"
            >
              <i className="block h-full bg-accent-fill" style={{ width: `${step.percent}%` }} />
            </div>
          ) : (
            <div aria-hidden="true" data-slot="ai-step-bar-space" className="ml-6.5 h-1" />
          )}
        </div>
      ))}
    </div>
  );
}

type TileHintProps = React.ComponentProps<"div"> & {
  percent: number;
  action?: React.ReactNode;
};

function TileHint({ percent, action, className, children, ...props }: TileHintProps) {
  return (
    <div
      data-slot="tile-hint"
      role="status"
      className={cn(
        "grid gap-2 rounded-zone border border-line bg-surf-panel px-3.5 py-2.5 text-body-sm leading-[1.45] text-fg shadow-pop",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-4">
        <span className="min-w-0 flex-1">{children}</span>
        {action}
      </div>
      <div aria-hidden="true" className="h-0.5 overflow-hidden rounded-full bg-chrome-2">
        <i className="block h-full bg-accent-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export {
  AiRunningSteps,
  type AiStep,
  ClassCounts,
  type ResultSetRowItem,
  ResultSetRows,
  ScoreHistogram,
  SetChip,
  SwipeHandle,
  TileHint,
  type ViewOption,
  ViewPicker,
  VizKey,
  VizLegend,
  VizRamp,
};
