import { Icon, type IconName } from "@parfocal/ui/components/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { scrollRegionProps } from "@parfocal/ui/lib/scroll-region";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

function CodeBlock({ className, ...props }: React.ComponentProps<"pre">) {
  return (
    <pre
      data-slot="code-block"
      {...scrollRegionProps("Code example")}
      className={cn(
        "m-0 overflow-auto rounded-zone border border-line bg-chrome px-4 py-3.5 font-mono text-caption leading-[1.6] whitespace-pre text-fg-dim focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent focus-visible:outline-solid",
        className,
      )}
      {...props}
    />
  );
}

function CodeKey({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="code-key" className={cn("text-accent", className)} {...props} />;
}

type KeyValueRow = { icon: IconName; label: string; value: React.ReactNode };

type KeyValueListProps = React.ComponentProps<"dl"> & { rows: KeyValueRow[]; tight?: boolean };

function KeyValueList({ rows, tight = false, className, ...props }: KeyValueListProps) {
  return (
    <dl
      data-slot="key-value-list"
      className={cn(
        "m-0 grid grid-cols-[minmax(120px,168px)_minmax(0,1fr)] gap-x-4 text-body-sm leading-[1.45]",
        tight ? "gap-y-1.5" : "gap-y-2.5",
        className,
      )}
      {...props}
    >
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="flex min-w-0 items-start gap-2 text-fg-dim">
            <Icon name={row.icon} className="mt-0.5 shrink-0" />
            <span>{row.label}</span>
          </dt>
          <dd className="m-0 min-w-0 text-fg [overflow-wrap:anywhere]">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

type TilePoint = readonly [number, number];

type TileCell = { x: number; y: number; rx: number; ry: number; colour: string };

type SampleTilePreviewProps = Omit<React.ComponentProps<"figure">, "children"> & {
  state: "empty" | "ok" | "fail";
  image: string;
  regions?: readonly (readonly TilePoint[])[];
  regionColour?: string;
  cells?: TileCell[];
  time?: string | undefined;
  emptyText?: React.ReactNode;
  label: string;
};

const tileWidth = 272;
const tileHeight = 196;

function SampleTilePreview({
  state,
  image,
  regions = [],
  regionColour = "var(--c-tumor)",
  cells = [],
  time,
  emptyText,
  label,
  className,
  ...props
}: SampleTilePreviewProps) {
  if (state === "empty") {
    return (
      <figure
        data-slot="sample-tile-preview"
        data-state="empty"
        className={cn(
          "m-0 grid h-49 place-items-center rounded-zone border border-dashed border-line-strong bg-surf-section p-4.5 text-center text-body-sm leading-[1.45] text-fg-dim",
          className,
        )}
        {...props}
      >
        <figcaption>{emptyText}</figcaption>
      </figure>
    );
  }
  return (
    <figure
      data-slot="sample-tile-preview"
      data-state={state}
      aria-label={label}
      className={cn(
        "relative m-0 h-49 overflow-hidden rounded-zone border border-line bg-size-[760px_auto] bg-position-[40%_30%]",
        state === "fail" && "brightness-80 saturate-40",
        className,
      )}
      style={{ backgroundImage: `url(${image})` }}
      {...props}
    >
      <svg
        viewBox={`0 0 ${tileWidth} ${tileHeight}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-0 size-full"
      >
        {state === "ok"
          ? regions.map((points) => (
              <polygon
                key={points.map((point) => point.join(",")).join(" ")}
                points={points.map((point) => point.join(",")).join(" ")}
                fill={regionColour}
                fillOpacity={0.14}
                stroke={regionColour}
                strokeWidth={2.4}
              />
            ))
          : null}
        {state === "ok"
          ? cells.map((cell) => (
              <ellipse
                key={`${cell.x}-${cell.y}`}
                cx={cell.x}
                cy={cell.y}
                rx={cell.rx}
                ry={cell.ry}
                fill="none"
                stroke={cell.colour}
                strokeWidth={1.8}
              />
            ))
          : null}
      </svg>
      {time ? (
        <figcaption className="absolute bottom-2 left-2 inline-flex h-5.5 items-center rounded-md bg-black/66 px-2 font-mono text-caption font-medium text-white">
          {time}
        </figcaption>
      ) : null}
    </figure>
  );
}

type ClassOption = { value: string; label: string; colour?: string };

type ClassMapRow = { sent: string; count: React.ReactNode; value: string | null };

type ClassMapTableProps = Omit<React.ComponentProps<"table">, "onChange"> & {
  rows: ClassMapRow[];
  options: ClassOption[];
  onValueChange?: (sent: string, value: string) => void;
  sentLabel?: string;
  becomesLabel?: string;
  countLabel?: string;
  placeholder?: string;
};

function OptionLabel({ option }: { option: ClassOption }) {
  return (
    <span className="inline-flex items-center gap-2">
      {option.colour ? (
        <span
          aria-hidden="true"
          className="size-2.5 rounded-[3px]"
          style={{ background: option.colour }}
        />
      ) : null}
      {option.label}
    </span>
  );
}

function ClassMapTable({
  rows,
  options,
  onValueChange,
  sentLabel = "It sends",
  becomesLabel = "Becomes",
  countLabel = "In the test",
  placeholder = "Choose a class",
  className,
  ...props
}: ClassMapTableProps) {
  return (
    <table
      data-slot="class-map-table"
      className={cn("w-full table-fixed border-collapse text-body-sm", className)}
      {...props}
    >
      <thead>
        <tr className="border-b border-line-strong text-left text-caption font-semibold text-fg-dim">
          <th className="w-[34%] py-2 font-semibold">{sentLabel}</th>
          <th className="w-10">
            <span className="sr-only">Maps to</span>
          </th>
          <th className="py-2 font-semibold">{becomesLabel}</th>
          <th className="w-28 py-2 text-right font-semibold">{countLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const chosen = options.find((option) => option.value === row.value);
          return (
            <tr key={row.sent} className="border-t border-line first:border-t-0">
              <td className="h-11.5">
                <code className="font-mono text-fg">{row.sent}</code>
              </td>
              <td className="text-fg-faint">
                <Icon name="next" />
              </td>
              <td>
                <Select
                  value={row.value}
                  onValueChange={(value) => onValueChange?.(row.sent, String(value))}
                >
                  <SelectTrigger size="sm" aria-label={`Class for ${row.sent}`} className="w-55">
                    {chosen ? (
                      <SelectValue>
                        <OptionLabel option={chosen} />
                      </SelectValue>
                    ) : (
                      <SelectValue placeholder={placeholder} />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <OptionLabel option={option} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              <td className="text-right font-mono text-fg-dim">{row.count}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export {
  type ClassMapRow,
  ClassMapTable,
  type ClassMapTableProps,
  type ClassOption,
  CodeBlock,
  CodeKey,
  KeyValueList,
  type KeyValueListProps,
  type KeyValueRow,
  SampleTilePreview,
  type SampleTilePreviewProps,
  type TileCell,
  type TilePoint,
};
