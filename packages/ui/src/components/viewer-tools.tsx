import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { Zone } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";
import { useState } from "react";

const floatSurface = "rounded-[10px] border border-line bg-chrome shadow-pop";

type DistanceCueProps = Omit<React.ComponentProps<"button">, "children"> & {
  label: string;
  distance: string;
  direction: "back" | "next";
  active?: boolean;
};

function DistanceCue({
  label,
  distance,
  direction,
  active = false,
  className,
  ...props
}: DistanceCueProps) {
  return (
    <button
      type="button"
      data-slot="distance-cue"
      data-active={active || undefined}
      className={cn(
        "absolute z-2 inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line-strong bg-chrome py-1.25 pr-2.25 pl-1.75 text-caption text-fg shadow-pop hover:border-accent data-active:border-accent [&_svg]:text-c-tumor",
        className,
      )}
      {...props}
    >
      {direction === "back" ? <Icon name="back" /> : null}
      <Icon name="flag" />
      <span>
        <b className="font-semibold">{label}</b> · {distance} away
      </span>
      {direction === "next" ? <Icon name="next" /> : null}
    </button>
  );
}

type ScreenPoint = { x: number; y: number };

function RulerLine({
  from,
  to,
  label,
  dashed = false,
  className,
}: {
  from: ScreenPoint;
  to: ScreenPoint;
  label: string;
  dashed?: boolean;
  className?: string;
}) {
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const boxWidth = dashed ? 92 : 68;
  return (
    <svg
      data-slot="ruler-line"
      role="img"
      aria-label={`Measured ${label}`}
      className={cn("pointer-events-none absolute inset-0 size-full overflow-visible", className)}
    >
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="#fff"
        strokeWidth={dashed ? 3 : 2.5}
      />
      {dashed ? (
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="#111"
          strokeWidth={1}
          strokeDasharray="6 6"
        />
      ) : null}
      {[from, to].map((point) => (
        <circle
          key={`${point.x},${point.y}`}
          cx={point.x}
          cy={point.y}
          r={dashed ? 6 : 4}
          fill="#fff"
          stroke={dashed ? "#111" : "none"}
        />
      ))}
      <rect
        x={mid.x - boxWidth / 2}
        y={mid.y - (dashed ? 40 : 30)}
        width={boxWidth}
        height={dashed ? 26 : 20}
        rx={dashed ? 5 : 4}
        fill={dashed ? "#111" : "#1d1d1d"}
      />
      <text
        x={mid.x}
        y={mid.y - (dashed ? 22 : 16)}
        textAnchor="middle"
        fill="#fff"
        fontSize={dashed ? 14 : 12}
        fontFamily="IBM Plex Mono, monospace"
      >
        {label}
      </text>
    </svg>
  );
}

function ContextBar({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { label: string }) {
  return (
    <div
      data-slot="context-bar"
      role="toolbar"
      aria-label={`${label} options`}
      className={cn(
        "absolute top-3 left-1/2 z-4 flex -translate-x-1/2 items-center gap-2.5 py-1.5 pr-2 pl-3 text-caption whitespace-nowrap",
        floatSurface,
        className,
      )}
      {...props}
    >
      <span className="text-fg-faint">{label}</span>
      {children}
    </div>
  );
}

function ContextPill({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="context-pill"
      className={cn("rounded-md border border-line bg-chrome-2 px-2 py-0.75", className)}
      {...props}
    />
  );
}

function ContextDivider() {
  return <span aria-hidden="true" className="h-5 w-px bg-line" />;
}

type Tier = {
  name: string;
  description: string;
  model: string;
  speed: 1 | 2 | 3;
  colour: string;
};

function TierPill({
  tier,
  open = false,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "children"> & { tier: Tier; open?: boolean }) {
  return (
    <button
      type="button"
      data-slot="tier-pill"
      aria-haspopup="dialog"
      aria-expanded={open}
      title={tier.model}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-chrome-2 px-2 py-0.75 text-caption text-fg hover:border-accent aria-expanded:border-accent",
        className,
      )}
      {...props}
    >
      <i
        aria-hidden="true"
        className="size-1.75 rounded-full"
        style={{ background: tier.colour }}
      />
      {tier.name}
      <Icon name="down" size="xs" />
    </button>
  );
}

function SpeedBars({ speed }: { speed: number }) {
  return (
    <span
      role="img"
      aria-label={`Speed ${speed} of 3`}
      title="speed"
      className="inline-flex gap-0.5"
    >
      {[1, 2, 3].map((step) => (
        <i
          key={step}
          className={cn("h-2.5 w-1.25 rounded-[1px]", step <= speed ? "bg-fg-dim" : "bg-chrome-3")}
        />
      ))}
    </span>
  );
}

type TierPickerProps = Omit<React.ComponentProps<"div">, "title"> & {
  title: string;
  tiers: Tier[];
  value: string;
  onValueChange: (name: string) => void;
  onClose: () => void;
  note?: React.ReactNode;
};

function TierPicker({
  title,
  tiers,
  value,
  onValueChange,
  onClose,
  note,
  className,
  ...props
}: TierPickerProps) {
  const [pointed, setPointed] = useState<string | null>(null);
  return (
    <div
      data-slot="tier-picker"
      role="dialog"
      aria-label="Choose a model"
      className={cn("absolute z-20 grid w-105 gap-0.5 p-2", floatSurface, className)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      {...props}
    >
      <div className="flex items-center justify-between px-2.5 pt-1.5 pb-2">
        <span className="text-caption font-semibold text-fg-dim">{title}</span>
        <button
          type="button"
          aria-label="Close"
          title="Close (Esc)"
          onClick={onClose}
          className="grid size-7 cursor-pointer place-items-center rounded-ctl border-0 bg-transparent text-fg-dim hover:bg-chrome-2 hover:text-fg"
        >
          <Icon name="close" />
        </button>
      </div>
      <div role="radiogroup" aria-label={title} className="grid gap-0.5">
        {tiers.map((tier) => {
          const selected = tier.name === value;
          const shown = pointed === tier.name;
          return (
            <div
              key={tier.name}
              role="radio"
              aria-checked={selected}
              tabIndex={0}
              data-pointed={shown || undefined}
              onClick={() => onValueChange(tier.name)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onValueChange(tier.name);
                }
              }}
              onPointerEnter={() => setPointed(tier.name)}
              onPointerLeave={() => setPointed(null)}
              onFocus={() => setPointed(tier.name)}
              onBlur={() => setPointed(null)}
              className="grid cursor-pointer grid-cols-[22px_1fr_auto] items-start gap-2.5 rounded-ctl px-2.5 py-2.25 outline-none hover:bg-chrome-2 focus-visible:outline-2 focus-visible:outline-accent aria-checked:bg-accent-soft"
            >
              <i
                aria-hidden="true"
                className="mt-1.25 size-2.5 rounded-full"
                style={{ background: tier.colour }}
              />
              <span className="grid">
                <b className="flex items-center gap-2 text-body font-semibold">
                  {tier.name}
                  {selected ? (
                    <span className="inline-flex h-4.5 items-center rounded-full bg-[#15803d] px-1.5 text-label font-medium text-white">
                      selected
                    </span>
                  ) : null}
                </b>
                <small className="mt-0.5 text-body-sm leading-[1.45] text-fg-dim">
                  {tier.description}
                </small>
                {shown ? (
                  <code className="mt-1 font-mono text-caption text-fg-faint">{tier.model}</code>
                ) : null}
              </span>
              <SpeedBars speed={tier.speed} />
            </div>
          );
        })}
      </div>
      {note ? (
        <p className="m-0 mt-1 border-t border-line px-2.5 pt-2 pb-1 text-body-sm leading-[1.45] text-fg-dim">
          {note}
        </p>
      ) : null}
    </div>
  );
}

type LayerRow = {
  key: string;
  name: string;
  colour: string;
  proposal?: boolean;
  count: number;
  child?: boolean;
  locked?: boolean;
  current?: boolean;
};

function LayerList({
  rows,
  hidden = [],
  onToggle,
  className,
}: {
  rows: LayerRow[];
  hidden?: string[];
  onToggle?: (key: string) => void;
  className?: string;
}) {
  return (
    <ul
      data-slot="layer-list"
      aria-label="Layers"
      className={cn("m-0 grid list-none gap-0.5 p-0", className)}
    >
      {rows.map((row) => {
        const off = hidden.includes(row.key);
        return (
          <li
            key={row.key}
            data-current={row.current || undefined}
            className={cn(
              "grid grid-cols-[16px_10px_1fr_auto_24px_18px] items-center gap-1.75 rounded-md px-1 py-1 text-body-sm text-fg-dim data-current:bg-accent-soft data-current:text-fg",
              row.child && "pl-5.5",
            )}
          >
            {row.child ? <span /> : <Icon name="caret" className="text-fg-faint" />}
            <i
              aria-hidden="true"
              className="size-2.5 rounded-[3px]"
              style={
                row.proposal
                  ? { background: "var(--c-prop)", boxShadow: "0 0 0 1.5px #ffffff" }
                  : { background: row.colour }
              }
            />
            <span className="truncate">{row.name}</span>
            <span className="font-mono text-caption text-fg-faint">{row.count}</span>
            <button
              type="button"
              aria-pressed={!off}
              aria-label={`${off ? "Show" : "Hide"} ${row.name}`}
              onClick={() => onToggle?.(row.key)}
              className="grid size-6 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-fg-faint hover:bg-chrome-2 hover:text-fg"
            >
              <Icon name={off ? "eye-off" : "eye"} />
            </button>
            {row.locked ? <Icon name="lock" label="Locked" className="text-fg-faint" /> : <span />}
          </li>
        );
      })}
    </ul>
  );
}

type PaneSlide = {
  key: string;
  name: string;
  thumb: React.CSSProperties;
  simulated?: boolean;
};

function SlideThumb({ slide, large = false }: { slide: PaneSlide; large?: boolean }) {
  return (
    <i
      aria-hidden="true"
      className={cn(
        "block shrink-0 bg-[#f1eef2] bg-cover bg-position-[center_40%]",
        large ? "h-11 w-16 rounded-[5px] border border-line" : "h-4.5 w-6.5 rounded-[3px]",
      )}
      style={slide.thumb}
    />
  );
}

function SimulatedTag() {
  return (
    <span className="inline-flex h-4.5 items-center rounded-full bg-chrome-3 px-1.5 text-label font-medium text-fg-dim">
      simulated
    </span>
  );
}

type PaneSide = "left" | "right";

const sideWord: Record<PaneSide, string> = { left: "Left", right: "Right" };

function PaneHeader({
  side,
  slide,
  open = false,
  onOpenChange,
  className,
}: {
  side: PaneSide;
  slide: PaneSlide;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  return (
    <div
      data-slot="pane-header"
      className={cn("absolute top-3 left-3 z-4 flex items-center gap-2", className)}
    >
      <span className="rounded-[5px] bg-[rgb(17_17_17/0.72)] px-1.75 py-1 text-label font-bold text-white">
        {sideWord[side]}
      </span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Change the slide on this side"
        onClick={() => onOpenChange?.(!open)}
        className="inline-flex h-8.5 cursor-pointer items-center gap-2 rounded-ctl border border-line-strong bg-chrome py-0 pr-2.5 pl-1.25 text-body-sm text-fg shadow-pop hover:border-accent aria-expanded:border-accent"
      >
        <SlideThumb slide={slide} />
        <b className="font-semibold">{slide.name}</b>
        {slide.simulated ? <SimulatedTag /> : null}
        <Icon name="down" className="text-fg-faint" />
      </button>
    </div>
  );
}

type PickerSlide = PaneSlide & { note: string; here: boolean };

function PanePicker({
  side,
  slides,
  onPick,
  className,
}: {
  side: PaneSide;
  slides: PickerSlide[];
  onPick: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      data-slot="pane-picker"
      role="listbox"
      aria-label={`Slide for the ${side} side`}
      className={cn(
        "absolute top-13.5 left-3 z-20 grid w-82.5 gap-0.5 p-2",
        floatSurface,
        className,
      )}
    >
      <div className="px-2 pt-1 pb-2 text-caption font-semibold text-fg-dim">
        Show on the {side}
      </div>
      {slides.map((slide) => (
        <div
          key={slide.key}
          role="option"
          aria-selected={slide.here}
          tabIndex={0}
          onClick={() => onPick(slide.key)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onPick(slide.key);
            }
          }}
          className="grid cursor-pointer grid-cols-[64px_1fr_16px] items-center gap-3 rounded-ctl p-2 outline-none hover:bg-chrome-2 focus-visible:outline-2 focus-visible:outline-accent aria-selected:bg-accent-soft"
        >
          <SlideThumb slide={slide} large />
          <span className="grid">
            <b className="flex items-center gap-2 text-body-sm font-semibold">
              {slide.name}
              {slide.simulated ? <SimulatedTag /> : null}
            </b>
            <small className="text-caption leading-[1.45] text-fg-dim">{slide.note}</small>
          </span>
          {slide.here ? <Icon name="check" className="text-accent" /> : <span />}
        </div>
      ))}
    </div>
  );
}

function SlideSlot({
  side,
  slide,
  note,
  onChange,
}: {
  side: PaneSide;
  slide: PaneSlide;
  note: string;
  onChange: () => void;
}) {
  return (
    <div
      data-slot="slide-slot"
      className="grid grid-cols-[auto_64px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] bg-chrome-2 px-2.5 py-2"
    >
      <span className="text-caption font-semibold text-fg-dim">{sideWord[side]}</span>
      <SlideThumb slide={slide} large />
      <span className="grid min-w-0">
        <b className="text-body-sm font-semibold">{slide.name}</b>
        <small className="text-caption text-fg-faint">{note}</small>
      </span>
      <button
        type="button"
        onClick={onChange}
        aria-label={`Change the ${side} slide`}
        className="h-8 cursor-pointer rounded-ctl border border-line-strong bg-btn-bg px-2.5 text-body-sm font-medium text-fg hover:bg-chrome-3"
      >
        Change
      </button>
    </div>
  );
}

function SlidesOnScreenPanel({
  left,
  right,
  onChange,
  onSwap,
}: {
  left?: { slide: PaneSlide; note: string } | undefined;
  right?: { slide: PaneSlide; note: string } | undefined;
  onChange: (side: PaneSide) => void;
  onSwap: () => void;
}) {
  return (
    <Zone title="Slides on screen">
      <div className="grid gap-2">
        {left ? (
          <SlideSlot
            side="left"
            slide={left.slide}
            note={left.note}
            onChange={() => onChange("left")}
          />
        ) : null}
        {right ? (
          <SlideSlot
            side="right"
            slide={right.slide}
            note={right.note}
            onChange={() => onChange("right")}
          />
        ) : null}
        <Button className="w-full" onClick={onSwap}>
          <Icon name="slides" />
          Swap sides
        </Button>
      </div>
    </Zone>
  );
}

type SideToggleRow = { key: string; name: string; left: boolean; right: boolean };

function SideToggles({
  rows,
  onToggle,
}: {
  rows: SideToggleRow[];
  onToggle: (key: string, side: PaneSide) => void;
}) {
  return (
    <div data-slot="side-toggles" className="grid gap-0.5">
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[1fr_44px_44px] items-center py-1.5 text-body-sm"
        >
          <span>{row.name}</span>
          {(["left", "right"] as const).map((side) => (
            <button
              key={side}
              type="button"
              aria-pressed={row[side]}
              aria-label={`${row.name} on the ${side}`}
              onClick={() => onToggle(row.key, side)}
              className="grid size-5 cursor-pointer place-items-center justify-self-center rounded-[5px] border-[1.5px] border-line-strong bg-transparent p-0 text-white aria-pressed:border-accent-fill aria-pressed:bg-accent-fill"
            >
              {row[side] ? <Icon name="check" size="xs" /> : null}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function Crosshair({ x, y }: { x: number | string; y: number | string }) {
  return (
    <span
      data-slot="crosshair"
      aria-hidden="true"
      className="pointer-events-none absolute z-3 -mt-4.5 -ml-4.5 size-9 before:absolute before:top-0 before:left-4.25 before:h-9 before:w-0.5 before:bg-white before:shadow-[0_0_2px_#000] before:content-[''] after:absolute after:top-4.25 after:left-0 after:h-0.5 after:w-9 after:bg-white after:shadow-[0_0_2px_#000] after:content-['']"
      style={{ left: x, top: y }}
    />
  );
}

function FloatingPill({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="floating-pill"
      className={cn(
        "absolute top-3 left-1/2 z-4 flex -translate-x-1/2 items-center gap-3 px-3 py-1.25 text-caption whitespace-nowrap",
        floatSurface,
        className,
      )}
      {...props}
    />
  );
}

type AnswerKey = { key: string; label: string; onPress?: () => void; main?: boolean };

function KeyOptions({ keys }: { keys: AnswerKey[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {keys.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={item.onPress}
          data-main={item.main || undefined}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-ctl border border-line bg-chrome-2 px-1.5 pr-2.5 text-body-sm text-fg hover:border-line-strong data-main:border-accent data-main:bg-accent-soft"
        >
          <Keycap keys={item.key} />
          {item.label}
        </button>
      ))}
    </div>
  );
}

function FocusCard({
  title,
  status,
  text,
  keys,
  className,
}: {
  title: React.ReactNode;
  status: React.ReactNode;
  text: React.ReactNode;
  keys: AnswerKey[];
  className?: string;
}) {
  return (
    <section
      data-slot="focus-card"
      aria-label="The object in focus"
      className={cn("absolute z-4 flex w-79 flex-col gap-2 p-3", floatSurface, className)}
    >
      <div className="flex items-center justify-between gap-2 text-body-sm">
        <b className="font-semibold">{title}</b>
        {status}
      </div>
      <span className="text-body-sm text-fg-dim">{text}</span>
      <KeyOptions keys={keys} />
    </section>
  );
}

function CellHud({
  title,
  where,
  keys,
  className,
}: {
  title: string;
  where: string;
  keys: AnswerKey[];
  className?: string;
}) {
  return (
    <section
      data-slot="cell-hud"
      aria-label="The cell under review"
      className={cn(
        "absolute bottom-18 left-1/2 z-4 flex w-140 -translate-x-1/2 flex-col gap-2.5 px-3.5 py-3",
        floatSurface,
        className,
      )}
    >
      <div className="flex items-baseline justify-between">
        <b className="text-body font-semibold">{title}</b>
        <span className="font-mono text-caption text-fg-faint">{where}</span>
      </div>
      <KeyOptions keys={keys} />
    </section>
  );
}

export {
  type AnswerKey,
  CellHud,
  ContextBar,
  ContextDivider,
  ContextPill,
  Crosshair,
  DistanceCue,
  FloatingPill,
  FocusCard,
  KeyOptions,
  LayerList,
  type LayerRow,
  PaneHeader,
  PanePicker,
  type PaneSide,
  type PaneSlide,
  type PickerSlide,
  RulerLine,
  type SideToggleRow,
  SideToggles,
  SlideSlot,
  SlidesOnScreenPanel,
  type Tier,
  TierPicker,
  TierPill,
};
