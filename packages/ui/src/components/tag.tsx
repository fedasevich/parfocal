import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type * as React from "react";

const tagBase =
  "inline-flex h-5 shrink-0 items-center gap-1.25 whitespace-nowrap text-label leading-none select-none";

const statusTagVariants = cva(`${tagBase} rounded-full px-2 font-semibold`, {
  variants: {
    tone: {
      neutral: "bg-chrome-3 text-fg-dim",
      accent: "bg-accent-soft text-accent",
      ok: "bg-[color-mix(in_srgb,var(--ok)_16%,transparent)] text-ok",
      warn: "bg-[color-mix(in_srgb,var(--warn)_16%,transparent)] text-warn",
      bad: "bg-[color-mix(in_srgb,var(--bad)_16%,transparent)] text-bad",
      research: "bg-[color-mix(in_srgb,var(--res)_18%,transparent)] text-research-fg",
    },
  },
  defaultVariants: { tone: "neutral" },
});

type StatusTone = NonNullable<VariantProps<typeof statusTagVariants>["tone"]>;

type StatusTagProps = React.ComponentProps<"span"> & { tone?: StatusTone };

function StatusTag({ tone, className, children, ...props }: StatusTagProps) {
  return (
    <span
      data-slot="status-tag"
      data-tone={tone ?? "neutral"}
      className={cn(statusTagVariants({ tone }), className)}
      {...props}
    >
      <i aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

type CategoryTagProps = React.ComponentProps<"span"> & {
  icon?: IconName;
  tone?: "neutral" | "info";
};

function CategoryTag({ icon, tone = "neutral", className, children, ...props }: CategoryTagProps) {
  return (
    <span
      data-slot="category-tag"
      data-tone={tone}
      className={cn(
        tagBase,
        "rounded-sm px-1.75 font-medium",
        tone === "info" ? "bg-accent-soft text-accent" : "bg-chrome-3 text-fg-dim",
        className,
      )}
      {...props}
    >
      {icon ? <Icon name={icon} size="xs" /> : null}
      {children}
    </span>
  );
}

type ObjectIdTagProps = React.ComponentProps<"span"> & { size?: "md" | "lg" };

function ObjectIdTag({ size = "md", className, ...props }: ObjectIdTagProps) {
  return (
    <span
      data-slot="object-id-tag"
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap border border-line-strong bg-chrome-3 font-mono font-semibold leading-none text-fg",
        size === "lg" ? "h-7 rounded-md px-2.25 text-body" : "h-5 rounded-sm px-1.5 text-label",
        className,
      )}
      {...props}
    />
  );
}

type ResultSetSource = "imported" | "run" | "reviewed";

type ResultSetTagProps = React.ComponentProps<"span"> & { source?: ResultSetSource };

const resultSetTones: Record<ResultSetSource, string> = {
  imported: "bg-accent-soft text-accent",
  run: "bg-[color-mix(in_srgb,var(--ok)_16%,transparent)] text-ok",
  reviewed: "bg-chrome-3 text-fg-dim",
};

function ResultSetTag({ source = "reviewed", className, children, ...props }: ResultSetTagProps) {
  return (
    <span
      data-slot="result-set-tag"
      data-source={source}
      className={cn(tagBase, "rounded-sm px-1.75 font-medium", resultSetTones[source], className)}
      {...props}
    >
      <Icon name="layers" size="xs" />
      {children}
    </span>
  );
}

type CountBadgeProps = React.ComponentProps<"span"> & { attention?: boolean };

function CountBadge({ attention = false, className, ...props }: CountBadgeProps) {
  return (
    <span
      data-slot="count-badge"
      data-attention={attention || undefined}
      className={cn(
        "inline-block h-4 min-w-4 shrink-0 rounded-lg px-1.25 text-center text-label leading-4 font-semibold tabular-nums",
        attention ? "bg-accent-fill text-on-accent" : "bg-chrome-3 text-fg-dim",
        className,
      )}
      {...props}
    />
  );
}

type FilterChipProps = TogglePrimitive.Props;

function FilterChip({ className, children, ...props }: FilterChipProps) {
  return (
    <TogglePrimitive
      data-slot="filter-chip"
      className={cn(
        "group/chip inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line-strong bg-transparent px-3 text-caption leading-none font-medium whitespace-nowrap text-fg-dim outline-none hover:border-fg-faint hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-pressed:border-accent data-pressed:bg-surf-hl data-pressed:text-fg",
        className,
      )}
      {...props}
    >
      <Icon name="check" size="xs" className="hidden group-data-pressed/chip:block" />
      {children}
    </TogglePrimitive>
  );
}

export {
  CategoryTag,
  type CategoryTagProps,
  CountBadge,
  type CountBadgeProps,
  FilterChip,
  type FilterChipProps,
  ObjectIdTag,
  type ObjectIdTagProps,
  type ResultSetSource,
  ResultSetTag,
  type ResultSetTagProps,
  StatusTag,
  type StatusTagProps,
  type StatusTone,
  statusTagVariants,
};
