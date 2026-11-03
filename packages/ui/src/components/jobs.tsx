import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { ProgressBar, type ProgressTone } from "@parfocal/ui/components/progress-meter";
import { cn } from "@parfocal/ui/lib/utils";
import * as React from "react";

const ringRadius = 15.9155;

type ValueRingProps = Omit<React.ComponentProps<"span">, "children"> & {
  value: number;
  size?: number;
  stroke?: number;
  text?: React.ReactNode;
  label?: string;
};

function ValueRing({
  value,
  size = 40,
  stroke,
  text,
  label,
  className,
  style,
  ...props
}: ValueRingProps) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  const width = ((stroke ?? (size < 32 ? 3.5 : 4.5)) * 36) / size;
  const dash = Math.max(0.01, percent);
  return (
    <span
      data-slot="value-ring"
      role="img"
      aria-label={label ?? `${percent}%`}
      title={label ?? `${percent}%`}
      className={cn("relative inline-grid shrink-0 place-items-center align-middle", className)}
      style={{ width: size, height: size, ...style }}
      {...props}
    >
      <svg aria-hidden="true" viewBox="0 0 36 36" className="absolute inset-0 size-full">
        <g transform="rotate(-90 18 18)">
          <circle
            cx="18"
            cy="18"
            r={ringRadius}
            fill="none"
            stroke="var(--v-open)"
            strokeWidth={width}
          />
          {percent > 0 ? (
            <circle
              cx="18"
              cy="18"
              r={ringRadius}
              fill="none"
              stroke="var(--accent-fill)"
              strokeWidth={width}
              strokeDasharray={`${dash} ${100 - dash}`}
            />
          ) : null}
        </g>
      </svg>
      <b
        aria-hidden="true"
        className="relative font-mono leading-none font-semibold tracking-tight text-fg"
        style={{ fontSize: Math.max(9, Math.round(size * 0.26)) }}
      >
        {text ?? `${percent}%`}
      </b>
    </span>
  );
}

type JobsButtonProps = Omit<React.ComponentProps<"button">, "children"> & {
  running: number;
  percent: number;
  open?: boolean;
};

function JobsButton({ running, percent, open = false, className, ...props }: JobsButtonProps) {
  return (
    <button
      type="button"
      data-slot="jobs-button"
      aria-label={`Jobs, ${running} running`}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={`Jobs: ${running} running. Uploads and model runs`}
      className={cn(
        "grid size-8 cursor-pointer place-items-center rounded-ctl border border-transparent bg-transparent p-0 hover:bg-[color-mix(in_srgb,var(--fg)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent",
        open && "bg-[color-mix(in_srgb,var(--fg)_8%,transparent)]",
        className,
      )}
      {...props}
    >
      <ValueRing
        value={percent}
        size={26}
        stroke={3}
        text={String(running)}
        label={`${running} running, ${percent}%`}
        className="[&_b]:text-[11px]"
      />
    </button>
  );
}

type JobRowProps = Omit<React.ComponentProps<"div">, "title"> & {
  icon: IconName;
  title: React.ReactNode;
  detail: React.ReactNode;
  percent: number;
  valueText: React.ReactNode;
  tone?: ProgressTone;
  action?: React.ReactNode;
  onOpen?: () => void;
};

function JobRow({
  icon,
  title,
  detail,
  percent,
  valueText,
  tone = "accent",
  action,
  onOpen,
  className,
  ...props
}: JobRowProps) {
  const label = typeof title === "string" ? title : undefined;
  return (
    <div
      data-slot="job-row"
      className={cn(
        "relative -mx-2 grid grid-cols-[16px_minmax(0,1fr)] items-start gap-3 rounded-ctl px-2 py-2 focus-within:outline-2 focus-within:outline-solid focus-within:outline-accent hover:bg-[color-mix(in_srgb,var(--fg)_6%,transparent)]",
        className,
      )}
      {...props}
    >
      <Icon name={icon} className="mt-0.5 text-fg-dim" />
      <div className="grid min-w-0 gap-2">
        <div className="flex min-w-0 items-baseline justify-between gap-2.5">
          <button
            type="button"
            title="Show every step"
            onClick={onOpen}
            className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-body-sm font-semibold text-fg outline-none after:absolute after:inset-0 after:content-['']"
          >
            {title}
          </button>
          <span className="relative z-10 flex flex-none items-center gap-2.5">
            {action}
            <Icon name="next" className="self-center text-fg-faint" />
          </span>
        </div>
        <ProgressBar
          value={percent}
          label={detail}
          valueText={valueText}
          tone={tone}
          aria-label={label}
        />
      </div>
    </div>
  );
}

function JobRowLink({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-6 cursor-pointer items-center border-0 bg-transparent px-1 text-body-sm text-accent hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent",
        className,
      )}
      {...props}
    />
  );
}

type JobsTrayProps = React.ComponentProps<"div"> & {
  running: React.ReactNode[];
  finished: React.ReactNode[];
};

function JobsTray({ running, finished, className, ...props }: JobsTrayProps) {
  return (
    <div data-slot="jobs-tray" className={cn("grid w-95 pt-1.5", className)} {...props}>
      <div className="flex items-baseline gap-2.5 px-4 pt-2.5 pb-1.5">
        <b className="text-body text-fg">Jobs</b>
        <span className="text-body-sm text-fg-dim">
          Uploads and model runs · click one for its steps
        </span>
      </div>
      <section className="grid gap-0.5 px-4 pt-2 pb-2.5">
        <span className="pt-1 pb-1.5 text-caption font-semibold text-fg-dim">
          Running · {running.length}
        </span>
        {running.length > 0 ? (
          running.map((row, index) => <React.Fragment key={index}>{row}</React.Fragment>)
        ) : (
          <span className="text-body-sm text-fg-dim">Nothing running</span>
        )}
      </section>
      <section className="grid gap-0.5 border-t border-line px-4 pt-2 pb-2.5">
        <span className="pt-1 pb-1.5 text-caption font-semibold text-fg-dim">Finished</span>
        {finished.map((row, index) => (
          <React.Fragment key={index}>{row}</React.Fragment>
        ))}
      </section>
      <div className="flex items-start gap-2 rounded-b-zone border-t border-line bg-surf-section px-4 py-3 text-body-sm leading-[1.45] text-fg-dim">
        <Icon name="bell" className="mt-0.5" />
        <span>
          Jobs keep going when you close the tab. You get a notification when one finishes.
        </span>
      </div>
    </div>
  );
}

export {
  JobRow,
  JobRowLink,
  type JobRowProps,
  JobsButton,
  type JobsButtonProps,
  JobsTray,
  type JobsTrayProps,
  ValueRing,
  type ValueRingProps,
};
