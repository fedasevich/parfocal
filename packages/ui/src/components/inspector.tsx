import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { CategoryTag, ObjectIdTag } from "@parfocal/ui/components/tag";
import {
  aiWording,
  type TypeCall,
  type TyperEvidence,
  type WordingSetting,
} from "@parfocal/ui/lib/confidence-words";
import {
  classCount,
  type NumberLineClass,
  numberLineLabel,
  numberLineTotals,
} from "@parfocal/ui/lib/number-line";
import {
  countBarGeometry,
  type SizeScaleDot,
  sizeScaleGeometry,
} from "@parfocal/ui/lib/size-scale";
import { resultChipText, type TumorShareResult } from "@parfocal/ui/lib/tumor-share";
import { cn } from "@parfocal/ui/lib/utils";
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

type RegionRowProps = Omit<React.ComponentProps<"div">, "onSelect"> & {
  objectId: string;
  kind: string;
  size: string;
  category?: string;
  selected?: boolean;
  note?: string | undefined;
  visited?: boolean;
  onSelect?: () => void;
  label?: string;
};

const regionRowClass =
  "grid w-full grid-cols-[auto_1fr_auto_auto_auto] items-center gap-x-2.5 rounded-md px-2 py-1.5 text-left text-body-sm text-fg-dim";

function RegionRow({
  objectId,
  kind,
  size,
  category,
  selected = false,
  note,
  visited = false,
  onSelect,
  label,
  className,
  ...props
}: RegionRowProps) {
  const cells = (
    <>
      <ObjectIdTag>{objectId}</ObjectIdTag>
      <span className="truncate text-fg">{kind}</span>
      <span className="font-mono tabular-nums">{size}</span>
      {category ? <CategoryTag>{category}</CategoryTag> : <span />}
      {visited ? (
        <span className="inline-flex items-center gap-1 text-ok" data-visited>
          <Icon name="check" />
          <span className="sr-only">visited</span>
        </span>
      ) : (
        <span />
      )}
      {note ? <span className="col-span-full pt-0.5 text-caption text-fg-dim">{note}</span> : null}
      {label ? <span className="sr-only">{label}</span> : null}
    </>
  );
  const look = cn(regionRowClass, selected && "bg-accent-soft", className);
  if (onSelect)
    return (
      <div data-slot="region-row" data-selected={selected || undefined} {...props}>
        <button
          type="button"
          aria-current={selected || undefined}
          className={cn(
            look,
            "cursor-pointer hover:bg-chrome-3 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent",
          )}
          onClick={onSelect}
        >
          {cells}
        </button>
      </div>
    );
  return (
    <div data-slot="region-row" data-selected={selected || undefined} className={look} {...props}>
      {cells}
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

type RangeBarProps = React.ComponentProps<"div"> & {
  min: number;
  max: number;
  low: number;
  high: number;
  point: number;
  cuts: number[];
  dots?: readonly SizeScaleDot[];
  number?: number;
};

function RangeBar({
  min,
  max,
  low,
  high,
  point,
  cuts,
  dots,
  number,
  className,
  ...props
}: RangeBarProps) {
  const geometry = sizeScaleGeometry({
    min,
    max,
    low,
    high,
    point,
    cuts,
    ...(dots ? { dots } : {}),
  });
  return (
    <div
      data-slot="range-bar"
      role="img"
      aria-label={`${point} mm, between ${low} and ${high} mm`}
      className={cn("relative mt-3 h-14", className)}
      {...props}
    >
      {geometry.zones.map((zone) => (
        <span
          key={zone.name}
          data-zone={zone.name}
          className="absolute top-0 text-center font-mono text-label text-fg-faint"
          style={{ left: `${zone.left}%`, width: `${zone.width}%` }}
        >
          {zone.name}
        </span>
      ))}
      <span className="absolute top-8.75 right-0 left-0 h-1 rounded-[2px] bg-chrome-3" />
      <span
        data-part="band"
        className="absolute top-8 h-2.5 rounded-[5px] bg-c-tumor opacity-55"
        style={{ left: `${geometry.bandLeft}%`, width: `${geometry.bandWidth}%` }}
      />
      {geometry.dots.map((dot) => (
        <span
          key={dot.number}
          data-part="dot"
          data-area={dot.number}
          className="absolute top-8.5 size-1.5 -translate-x-1/2 rounded-full bg-fg-dim"
          style={{ left: `${dot.left}%` }}
        />
      ))}
      <span
        data-part="point"
        className="absolute top-7 h-3.5 w-0.75 rounded-[2px] bg-c-tumor"
        style={{ left: `${geometry.point}%` }}
      />
      {number != null ? (
        <span
          data-part="point-number"
          className="absolute top-4 grid size-4 -translate-x-1/2 place-items-center rounded-full bg-c-tumor font-mono text-label font-semibold text-bg"
          style={{ left: `${geometry.point}%` }}
        >
          {number}
        </span>
      ) : null}
      {geometry.cuts.map((cut) => (
        <span key={cut.mm}>
          <span
            data-part="cut"
            className="absolute top-6 h-5 w-0 border-l-2 border-dashed border-fg-dim"
            style={{ left: `${cut.left}%` }}
          />
          <span
            className="absolute top-11 -translate-x-1/2 font-mono text-label text-fg-faint"
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
  count?: { cells: number | null; line?: number; max?: number };
};

function StagingHero({
  title,
  category,
  sub,
  range,
  count,
  className,
  ...props
}: StagingHeroProps) {
  return (
    <div data-slot="staging-hero" className={cn("grid gap-2", className)} {...props}>
      <h3 className="m-0 mt-0.5 flex items-start justify-between gap-2.5 text-title leading-tight font-semibold">
        {title}
        <CategoryTag className="mt-0.75">{category}</CategoryTag>
      </h3>
      <p className="m-0 text-body-sm leading-normal text-fg-dim">{sub}</p>
      <RangeBar {...range} />
      {count ? (
        <div data-slot="count-block" data-counted={count.cells != null} className="grid gap-0.5">
          <CountBar
            count={count.cells ?? 0}
            {...(count.line != null ? { line: count.line } : {})}
            {...(count.max != null ? { max: count.max } : {})}
          />
          <span className="text-caption text-fg-dim">
            {count.cells == null
              ? "Tumor cells not counted yet"
              : `About ${count.cells} tumor cells, the line is at ${count.line ?? 200}`}
          </span>
        </div>
      ) : null}
    </div>
  );
}

type CountBarProps = React.ComponentProps<"div"> & { count: number; line?: number; max?: number };

function CountBar({ count, line = 200, max = 400, className, ...props }: CountBarProps) {
  const geometry = countBarGeometry(count, line, max);
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
          geometry.over ? "bg-warn" : "bg-accent-fill",
        )}
        style={{ width: `${geometry.fill}%` }}
      />
      <span
        className="absolute top-0.5 h-5 w-0 border-l-2 border-dashed border-fg-dim"
        style={{ left: `${geometry.line}%` }}
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
  classes: readonly NumberLineClass[];
  result?: TumorShareResult | null;
};

function ResultChip({ result }: { result: TumorShareResult }) {
  const open = result.side === "either";
  return (
    <span
      data-slot="result-chip"
      data-state={result.state}
      data-side={result.side}
      className={cn(
        "w-fit rounded-full border px-2 py-0.5 text-caption",
        open
          ? "border-dashed border-[color-mix(in_srgb,var(--v-unsure)_60%,transparent)] bg-[color-mix(in_srgb,var(--v-unsure)_14%,transparent)] text-fg"
          : "border-[color-mix(in_srgb,var(--v-agree)_60%,transparent)] bg-[color-mix(in_srgb,var(--v-agree)_14%,transparent)] text-fg",
      )}
    >
      {resultChipText(result)}
    </span>
  );
}

const unsureFill = "bg-[repeating-linear-gradient(-45deg,var(--unsure)_0_2px,transparent_2px_5px)]";

function Segment({
  part,
  count,
  max,
  className,
  style,
}: {
  part: string;
  count: number;
  max: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (count <= 0) return null;
  return (
    <span
      data-part={part}
      data-count={count}
      className={cn("block h-full", className)}
      style={{ width: `${(count / max) * 100}%`, ...style }}
    />
  );
}

function NumberLine({ classes, result, className, ...props }: NumberLineProps) {
  const totals = numberLineTotals(classes);
  const max = Math.max(1, ...classes.map(classCount));
  const grand = Math.max(1, totals.total);
  const number = (value: number) => value.toLocaleString("en-US");
  return (
    <div data-slot="number-line" className={cn("grid gap-2", className)} {...props}>
      {classes.map((row) => (
        <div
          key={row.name}
          data-slot="number-line-class"
          data-class={row.name}
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
          <span
            role="img"
            aria-label={`${row.name}: ${row.sure} sure, ${row.unsure} unsure`}
            className="flex h-1.5 overflow-hidden rounded-[3px] bg-track"
          >
            <Segment part="sure" count={row.sure} max={max} style={{ background: row.color }} />
            <Segment part="unsure" count={row.unsure} max={max} className={unsureFill} />
          </span>
          <span className="text-right font-mono text-fg-dim tabular-nums">
            {number(classCount(row))}
          </span>
        </div>
      ))}
      <div data-slot="number-line-total" className="grid gap-1.5 border-t border-line pt-2">
        <span
          role="img"
          aria-label={numberLineLabel(totals)}
          className="flex h-2 overflow-hidden rounded-full bg-track"
        >
          <Segment part="checked" count={totals.checked} max={grand} className="bg-agree" />
          <Segment part="sure" count={totals.sure} max={grand} className="bg-accent-fill" />
          <Segment part="unsure" count={totals.unsure} max={grand} className={unsureFill} />
        </span>
        <span data-slot="number-line-legend" className="text-caption text-fg-dim">
          {number(totals.checked)} checked by you · {number(totals.sure)} sure ·{" "}
          {number(totals.unsure)} unsure of {number(totals.total)}
        </span>
      </div>
      {result ? <ResultChip result={result} /> : null}
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
        "inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-caption text-fg-dim hover:text-fg focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent",
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

type AiCallLineProps = Omit<React.ComponentProps<"p">, "children"> & {
  calls: readonly TypeCall[];
  typer: TyperEvidence;
  wording: WordingSetting;
};

function AiCallLine({ calls, typer, wording, className, ...props }: AiCallLineProps) {
  const shown = aiWording(calls, wording, typer);
  if (shown.text === null) return null;
  return (
    <p
      data-slot="ai-call"
      data-wording={shown.mode ?? shown.setting}
      data-band={shown.band}
      className={cn("m-0 text-lead text-fg", className)}
      {...props}
    >
      {shown.text}
    </p>
  );
}

export {
  AiCallLine,
  type AiCallLineProps,
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
  StagingHero,
  StepBlock,
  WarnBar,
  ZoneRow,
};
