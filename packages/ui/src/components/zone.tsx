import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

const surfaceVariants = cva("min-w-0 text-fg", {
  variants: {
    level: {
      page: "bg-surf-page",
      panel: "bg-surf-panel",
      section: "bg-surf-section",
      highlight: "bg-surf-hl",
    },
  },
  defaultVariants: { level: "panel" },
});

type SurfaceProps = React.ComponentProps<"div"> & VariantProps<typeof surfaceVariants>;

function Surface({ level, className, ...props }: SurfaceProps) {
  return (
    <div
      data-slot="surface"
      data-level={level ?? "panel"}
      className={cn(surfaceVariants({ level }), className)}
      {...props}
    />
  );
}

function Zones({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="zones"
      className={cn("grid min-w-0 content-start gap-(--space-zone)", className)}
      {...props}
    />
  );
}

type ZoneProps = Omit<React.ComponentProps<"section">, "title"> & {
  title?: React.ReactNode;
  sub?: React.ReactNode;
  end?: React.ReactNode;
  highlight?: boolean | "warn";
  plain?: boolean;
};

function ZoneHeading({ title, sub, end }: Pick<ZoneProps, "title" | "sub" | "end">) {
  if (!title && !end) return null;
  return (
    <div
      className={cn("flex min-h-5 justify-between gap-2.5", sub ? "items-start" : "items-center")}
    >
      <div className="grid gap-0.5">
        {title ? <h3 className="m-0 text-body font-semibold text-fg">{title}</h3> : null}
        {sub ? <p className="m-0 text-body-sm text-fg-dim">{sub}</p> : null}
      </div>
      {end}
    </div>
  );
}

function Zone({ title, sub, end, highlight, plain, className, children, ...props }: ZoneProps) {
  return (
    <section
      data-slot="zone"
      data-highlight={highlight || undefined}
      className={cn(
        "grid min-w-0 content-start gap-(--space-in)",
        plain ? "" : "rounded-zone border border-surf-edge bg-surf-section p-(--pad-zone)",
        highlight === true &&
          "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-surf-hl",
        highlight === "warn" &&
          "border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_12%,var(--chrome))]",
        className,
      )}
      {...props}
    >
      <ZoneHeading title={title} sub={sub} end={end} />
      {children}
    </section>
  );
}

type FoldingZoneProps = Omit<CollapsiblePrimitive.Root.Props, "title"> & {
  title: React.ReactNode;
  summary: React.ReactNode;
};

function FoldingZone({ title, summary, className, children, ...props }: FoldingZoneProps) {
  return (
    <CollapsiblePrimitive.Root
      data-slot="folding-zone"
      className={cn(
        "group/fold grid min-w-0 content-start rounded-zone border border-surf-edge bg-surf-section",
        className,
      )}
      {...props}
    >
      <CollapsiblePrimitive.Trigger className="flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-zone border-0 bg-transparent p-(--pad-zone) text-left text-fg outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent">
        <span className="grid min-w-0 gap-0.5">
          <span className="text-body font-semibold">{title}</span>
          <small className="hidden truncate text-caption text-fg-dim group-data-closed/fold:block">
            {summary}
          </small>
        </span>
        <Icon
          name="down"
          className="text-fg-dim transition-transform group-data-closed/fold:-rotate-90"
        />
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Panel className="grid gap-(--space-in) px-(--pad-zone) pb-(--pad-zone)">
        {children}
      </CollapsiblePrimitive.Panel>
    </CollapsiblePrimitive.Root>
  );
}

function SectionLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="section-label"
      className={cn(
        "text-label font-semibold tracking-[0.07em] text-fg-faint uppercase",
        className,
      )}
      {...props}
    />
  );
}

function Hint({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="hint"
      className={cn("m-0 text-body-sm leading-[1.45] text-fg-dim", className)}
      {...props}
    />
  );
}

export {
  FoldingZone,
  type FoldingZoneProps,
  Hint,
  SectionLabel,
  Surface,
  type SurfaceProps,
  surfaceVariants,
  Zone,
  type ZoneProps,
  Zones,
};
