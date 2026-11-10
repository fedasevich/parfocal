import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { Icon } from "@parfocal/ui/components/icon";
import { scrollRegionProps } from "@parfocal/ui/lib/scroll-region";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type LaneArrowKind = "step" | "hand" | "wait";

type LaneArrowDirection = "r" | "l" | "u" | "d";

type LaneArrowHead = { x: number; y: number; direction: LaneArrowDirection };

type LaneArrow = { d: string; kind: LaneArrowKind; heads: LaneArrowHead[] };

type Box = { x: number; y: number; w: number; h: number };

const headSize = 5;

function headPoints({ x, y, direction }: LaneArrowHead): [number, number][] {
  const long = headSize * 1.6;
  if (direction === "r")
    return [
      [x, y],
      [x - long, y - headSize],
      [x - long, y + headSize],
    ];
  if (direction === "l")
    return [
      [x, y],
      [x + long, y - headSize],
      [x + long, y + headSize],
    ];
  if (direction === "d")
    return [
      [x, y],
      [x - headSize, y - long],
      [x + headSize, y - long],
    ];
  return [
    [x, y],
    [x - headSize, y + long],
    [x + headSize, y + long],
  ];
}

function headPath(head: LaneArrowHead) {
  return `M${headPoints(head)
    .map((point) => point.join(" "))
    .join(" L")} Z`;
}

const lineStyles: Record<LaneArrowKind, string> = {
  step: "stroke-fg-faint [stroke-width:1.5]",
  hand: "stroke-accent [stroke-width:2]",
  wait: "stroke-line-strong [stroke-width:1.5] [stroke-dasharray:4_5]",
};

const headStyles: Record<LaneArrowKind, string> = {
  step: "fill-fg-faint",
  hand: "fill-accent",
  wait: "fill-line-strong",
};

type LaneMapProps = React.ComponentProps<"div"> & { width: number; height: number };

function LaneMap({ width, height, className, children, ...props }: LaneMapProps) {
  return (
    <div
      data-slot="lane-map"
      {...scrollRegionProps("Flow lanes")}
      className={cn(
        "relative overflow-auto bg-surf-page focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent focus-visible:outline-solid",
        className,
      )}
      {...props}
    >
      <div className="relative" style={{ width, height }}>
        {children}
      </div>
    </div>
  );
}

type LaneMapHeaderProps = Omit<React.ComponentProps<"header">, "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
};

function LaneMapHeader({ title, description, className, ...props }: LaneMapHeaderProps) {
  return (
    <header
      data-slot="lane-map-header"
      className={cn("absolute top-[18px] right-6 left-6", className)}
      {...props}
    >
      <h1 className="m-0 font-semibold text-page-title text-fg leading-7">{title}</h1>
      {description ? <p className="mt-1.5 text-body text-fg-dim leading-5">{description}</p> : null}
    </header>
  );
}

type LaneMapLaneProps = Omit<React.ComponentProps<"section">, "title"> & {
  top: number;
  height: number;
  title: string;
  note?: string | undefined;
  people?: React.ReactNode;
};

function LaneMapLane({
  top,
  height,
  title,
  note,
  people,
  className,
  style,
  ...props
}: LaneMapLaneProps) {
  return (
    <section
      data-slot="lane-map-lane"
      aria-label={title}
      className={cn(
        "absolute right-6 left-6 rounded-zone border border-surf-edge bg-surf-section",
        className,
      )}
      style={{ top, height, ...style }}
      {...props}
    >
      <div className="flex h-[34px] items-center gap-3.5 px-[15px]">
        {people}
        <span className="whitespace-nowrap text-body-sm text-fg-dim">
          {title}
          {note ? ` · ${note}` : ""}
        </span>
      </div>
    </section>
  );
}

type LaneMapArrowsProps = React.ComponentProps<"svg"> & {
  arrows: LaneArrow[];
  width: number;
  height: number;
};

function LaneMapArrows({ arrows, width, height, className, ...props }: LaneMapArrowsProps) {
  return (
    <svg
      data-slot="lane-map-arrows"
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("pointer-events-none absolute top-0 left-0", className)}
      {...props}
    >
      {arrows.map((arrow) => (
        <g key={arrow.d} data-kind={arrow.kind}>
          <path d={arrow.d} className={cn("fill-none", lineStyles[arrow.kind])} />
          {arrow.heads.map((head) => (
            <path
              key={`${head.x},${head.y},${head.direction}`}
              d={headPath(head)}
              className={headStyles[arrow.kind]}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

type LaneMapBoxProps = useRender.ComponentProps<"button"> &
  Box & {
    title: React.ReactNode;
    sub?: React.ReactNode;
    dim?: boolean | undefined;
  };

function LaneMapBox({
  x,
  y,
  w,
  h,
  title,
  sub,
  dim,
  className,
  style,
  render,
  ...props
}: LaneMapBoxProps) {
  return useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(
      {
        className: cn(
          "absolute flex cursor-pointer flex-col items-start gap-1 overflow-hidden rounded-ctl border border-line bg-btn-bg px-2.5 py-[9px] text-left text-fg no-underline outline-none hover:border-accent hover:bg-[color-mix(in_srgb,var(--accent)_8%,var(--btn-bg))] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent focus-visible:outline-offset-2",
          dim && "border-dashed bg-transparent text-fg-dim",
          className,
        ),
        style: { left: x, top: y, width: w, height: h, ...style },
        children: (
          <>
            <b className="font-semibold text-body leading-[18px]">{title}</b>
            {sub ? <span className="text-body-sm text-fg-dim leading-4">{sub}</span> : null}
          </>
        ),
      },
      props,
    ),
    state: { slot: "lane-map-box", dim: Boolean(dim) },
  });
}

type LaneMapPillProps = React.ComponentProps<"span"> & { x: number; y: number };

function LaneMapPill({ x, y, className, style, children, ...props }: LaneMapPillProps) {
  return (
    <span
      data-slot="lane-map-pill"
      className={cn(
        "absolute inline-flex h-6 -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-accent bg-surf-panel px-2.5 font-semibold text-caption text-fg",
        className,
      )}
      style={{ left: x, top: y, ...style }}
      {...props}
    >
      <Icon name="users" size="xs" className="text-accent" />
      {children}
    </span>
  );
}

type LaneMapTextProps = React.ComponentProps<"p"> & {
  x: number;
  y: number;
  w: number;
  align?: "start" | "center";
};

function LaneMapText({ x, y, w, align, className, style, ...props }: LaneMapTextProps) {
  return (
    <p
      data-slot="lane-map-text"
      className={cn(
        "absolute m-0 text-body-sm text-fg-dim leading-5",
        align === "center" && "text-center",
        className,
      )}
      style={{ left: x, top: y, width: w, ...style }}
      {...props}
    />
  );
}

export {
  type LaneArrow,
  type LaneArrowDirection,
  type LaneArrowHead,
  type LaneArrowKind,
  LaneMap,
  LaneMapArrows,
  LaneMapBox,
  type LaneMapBoxProps,
  LaneMapHeader,
  LaneMapLane,
  type LaneMapLaneProps,
  LaneMapPill,
  type LaneMapProps,
  LaneMapText,
};
