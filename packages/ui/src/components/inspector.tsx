import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { CategoryTag, ObjectIdTag } from "@parfocal/ui/components/tag";
import { cn } from "cn";
import type * as React from "react";

function InspectorCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="inspector-card"
      className={cn("rounded-[10px] border border-line bg-chrome-2 p-3", className)}
      {...props}
    />
  );
}

function WarnBar({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="warn-bar"
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-ctl bg-warn-soft px-3 py-2 text-body-sm leading-[1.45] text-fg",
        className,
      )}
      {...props}
    >
      <Icon name="warn" className="mt-0.5 text-warn" />
      <span>{children}</span>
    </div>
  );
}

type RegionRowProps = React.ComponentProps<"div"> & {
  objectId: string;
  kind: string;
  size: string;
  category?: string;
  selected?: boolean;
};

function RegionRow({
  objectId,
  kind,
  size,
  category,
  selected = false,
  className,
  ...props
}: RegionRowProps) {
  return (
    <div
      data-slot="region-row"
      data-selected={selected || undefined}
      className={cn(
        "grid grid-cols-[auto_1fr_auto_auto] items-center gap-2.5 rounded-md px-2 py-1.5 text-body-sm text-fg-dim",
        selected && "bg-accent-soft",
        className,
      )}
      {...props}
    >
      <ObjectIdTag>{objectId}</ObjectIdTag>
      <span className="truncate text-fg">{kind}</span>
      <span className="font-mono tabular-nums">{size}</span>
      {category ? <CategoryTag>{category}</CategoryTag> : <span />}
    </div>
  );
}

type ClassBarsProps = React.ComponentProps<"div"> & {
  rows: Array<{ name: string; color: string; count: number }>;
};

function ClassBars({ rows, className, ...props }: ClassBarsProps) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div data-slot="class-bars" className={cn("grid gap-2", className)} {...props}>
      {rows.map((row) => (
        <div
          key={row.name}
          className="grid grid-cols-[72px_1fr_56px] items-center gap-2.5 text-body-sm"
        >
          <span className="inline-flex items-center gap-1.5 text-fg">
            <i
              aria-hidden="true"
              className="size-2.5 rounded-[3px]"
              style={{ background: row.color }}
            />
            {row.name}
          </span>
          <span className="h-1.5 overflow-hidden rounded-[3px] bg-track">
            <span
              className="block h-full rounded-[3px]"
              style={{ width: `${(row.count / max) * 100}%`, background: row.color }}
            />
          </span>
          <span className="text-right font-mono text-fg-dim tabular-nums">
            {row.count.toLocaleString("en-US")}
          </span>
        </div>
      ))}
    </div>
  );
}

const logPosition = (mm: number, min: number, max: number) =>
  ((Math.log10(mm) - Math.log10(min)) / (Math.log10(max) - Math.log10(min))) * 100;

type RangeBarProps = React.ComponentProps<"div"> & {
  min: number;
  max: number;
  low: number;
  high: number;
  point: number;
  cuts: number[];
};

function rangeGeometry({
  min,
  max,
  low,
  high,
  point,
  cuts,
}: Omit<RangeBarProps, keyof React.ComponentProps<"div">>) {
  return {
    bandLeft: logPosition(low, min, max),
    bandWidth: logPosition(high, min, max) - logPosition(low, min, max),
    point: logPosition(point, min, max),
    cuts: cuts.map((cut) => ({ mm: cut, left: logPosition(cut, min, max) })),
  };
}

function RangeBar({ min, max, low, high, point, cuts, className, ...props }: RangeBarProps) {
  const geometry = rangeGeometry({ min, max, low, high, point, cuts });
  return (
    <div
      data-slot="range-bar"
      role="img"
      aria-label={`${point} mm, between ${low} and ${high} mm`}
      className={cn("relative mt-3 h-8.5", className)}
      {...props}
    >
      <span className="absolute top-2.75 right-0 left-0 h-1 rounded-[2px] bg-chrome-3" />
      <span
        className="absolute top-2 h-2.5 rounded-[5px] bg-c-tumor opacity-55"
        style={{ left: `${geometry.bandLeft}%`, width: `${geometry.bandWidth}%` }}
      />
      <span
        className="absolute top-1.5 h-3.5 w-0.75 rounded-[2px] bg-c-tumor"
        style={{ left: `${geometry.point}%` }}
      />
      {geometry.cuts.map((cut) => (
        <span key={cut.mm}>
          <span
            className="absolute top-0.75 h-5 w-0 border-l-2 border-dashed border-fg-dim"
            style={{ left: `${cut.left}%` }}
          />
          <span
            className="absolute top-5.5 -translate-x-1/2 font-mono text-label text-fg-faint"
            style={{ left: `${cut.left}%` }}
          >
            {cut.mm} mm
          </span>
        </span>
      ))}
    </div>
  );
}

type StagingHeroProps = Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode;
  category: string;
  sub: React.ReactNode;
  range: Omit<RangeBarProps, keyof React.ComponentProps<"div">>;
};

function StagingHero({ title, category, sub, range, className, ...props }: StagingHeroProps) {
  return (
    <div data-slot="staging-hero" className={cn("grid gap-2", className)} {...props}>
      <h3 className="m-0 mt-0.5 flex items-start justify-between gap-2.5 text-title leading-tight font-semibold">
        {title}
        <CategoryTag className="mt-0.75">{category}</CategoryTag>
      </h3>
      <p className="m-0 text-body-sm leading-normal text-fg-dim">{sub}</p>
      <RangeBar {...range} />
    </div>
  );
}

type CountBarProps = React.ComponentProps<"div"> & { count: number; line?: number; max?: number };

function CountBar({ count, line = 200, max = 400, className, ...props }: CountBarProps) {
  return (
    <div
      data-slot="count-bar"
      role="img"
      aria-label={`${count} cells, the line is at ${line}`}
      className={cn("relative h-6", className)}
      {...props}
    >
      <span className="absolute top-2 right-0 left-0 h-2 rounded-full bg-track" />
      <span
        className={cn(
          "absolute top-2 left-0 h-2 rounded-full",
          count >= line ? "bg-warn" : "bg-accent-fill",
        )}
        style={{ width: `${Math.min(100, (count / max) * 100)}%` }}
      />
      <span
        className="absolute top-0.5 h-5 w-0 border-l-2 border-dashed border-fg-dim"
        style={{ left: `${(line / max) * 100}%` }}
      />
    </div>
  );
}

type StepBlockProps = Omit<React.ComponentProps<"div">, "title"> & {
  index: number;
  title: React.ReactNode;
  done?: boolean;
  answer?: React.ReactNode;
};

function StepBlock({
  index,
  title,
  done = false,
  answer,
  className,
  children,
  ...props
}: StepBlockProps) {
  return (
    <div
      data-slot="step-block"
      data-done={done || undefined}
      className={cn(
        "grid gap-2 rounded-[10px] border border-line p-3",
        done && "bg-chrome-2",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2 text-body-sm font-semibold">
        {done ? <Icon name="check" className="text-ok" /> : null}
        <span>
          {index} · {title}
        </span>
        {done && answer ? <span className="ml-auto font-normal text-fg-dim">{answer}</span> : null}
      </div>
      {done ? null : children}
    </div>
  );
}

type ZoneRowProps = React.ComponentProps<"div"> & {
  objectId: string;
  text: React.ReactNode;
  pinned?: boolean;
};

function ZoneRow({ objectId, text, pinned = false, className, ...props }: ZoneRowProps) {
  return (
    <div
      data-slot="zone-row"
      className={cn("flex items-center gap-2.5 py-1 text-body-sm text-fg-dim", className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className="size-3 shrink-0 rounded-[3px] border-[1.5px] border-dashed border-unsure bg-[repeating-linear-gradient(-45deg,var(--unsure)_0_2px,transparent_2px_5px)]"
      />
      <ObjectIdTag>{objectId}</ObjectIdTag>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <Icon
        name="target"
        label={pinned ? "Pinned" : "Pin"}
        className={pinned ? "text-pin" : "text-fg-faint"}
      />
    </div>
  );
}

type NumberLineProps = React.ComponentProps<"div"> & {
  sure: number;
  unsure: number;
  total: number;
};

function NumberLine({ sure, unsure, total, className, ...props }: NumberLineProps) {
  return (
    <div data-slot="number-line" className={cn("grid gap-1.5", className)} {...props}>
      <div
        role="img"
        aria-label={`${sure} sure and ${unsure} unsure of ${total}`}
        className="flex h-2 overflow-hidden rounded-full bg-track"
      >
        <span className="bg-accent-fill" style={{ width: `${(sure / total) * 100}%` }} />
        <span
          className="bg-[repeating-linear-gradient(-45deg,var(--unsure)_0_2px,transparent_2px_5px)]"
          style={{ width: `${(unsure / total) * 100}%` }}
        />
      </div>
      <span className="text-caption text-fg-dim">
        {sure.toLocaleString("en-US")} sure · {unsure.toLocaleString("en-US")} unsure
      </span>
    </div>
  );
}

type CellCropProps = React.ComponentProps<"div"> & {
  image: string;
  objectId: string;
  size?: number;
};

function CellCrop({ image, objectId, size = 72, className, ...props }: CellCropProps) {
  return (
    <div
      data-slot="cell-crop"
      role="img"
      aria-label={`Crop of ${objectId}`}
      className={cn(
        "relative shrink-0 rounded-md bg-[#111] bg-cover bg-center shadow-[inset_0_0_0_1px_var(--line)]",
        className,
      )}
      style={{ width: size, height: size, backgroundImage: `url(${image})` }}
      {...props}
    >
      <span className="absolute top-1/2 left-1/2 size-[42%] -translate-1/2 rounded-full border-[1.5px] border-dashed border-white/85" />
    </div>
  );
}

type BackLinkProps = React.ComponentProps<"button"> & { keyHint?: string };

function BackLink({ keyHint = "Esc", className, children, ...props }: BackLinkProps) {
  return (
    <button
      type="button"
      data-slot="back-link"
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-caption text-fg-dim hover:text-fg focus-visible:outline-2 focus-visible:outline-accent",
        className,
      )}
      {...props}
    >
      <Icon name="back" size="xs" />
      {children}
      <Keycap keys={keyHint} size="sm" />
    </button>
  );
}

type FactListProps = React.ComponentProps<"dl"> & {
  rows: Array<{ icon: IconName; label: string; value: React.ReactNode }>;
  tight?: boolean;
};

function FactList({ rows, tight = false, className, ...props }: FactListProps) {
  return (
    <dl
      data-slot="fact-list"
      className={cn(
        "m-0 grid text-body-sm leading-[1.45]",
        tight
          ? "grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5"
          : "grid-cols-[168px_minmax(0,1fr)] gap-x-4 gap-y-2.5",
        className,
      )}
      {...props}
    >
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="flex min-w-0 items-start gap-2 text-fg-dim">
            <Icon name={row.icon} className="mt-0.5" />
            <span>{row.label}</span>
          </dt>
          <dd className="m-0 min-w-0 [overflow-wrap:anywhere] text-fg">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export {
  BackLink,
  CellCrop,
  ClassBars,
  CountBar,
  FactList,
  type FactListProps,
  InspectorCard,
  NumberLine,
  RangeBar,
  type RangeBarProps,
  RegionRow,
  rangeGeometry,
  StagingHero,
  StepBlock,
  WarnBar,
  ZoneRow,
};
