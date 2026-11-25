import { columnWidths, Skeleton, SkeletonLine } from "@parfocal/ui/components/skeleton";
import { TableCell, TableRow } from "@parfocal/ui/components/table";
import { Zone } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";

type SkeletonZoneProps = Omit<React.ComponentProps<"section">, "title"> & {
  fields?: number;
};

function SkeletonZone({ fields = 2, className, ...props }: SkeletonZoneProps) {
  return (
    <Zone data-slot="skeleton-zone" aria-hidden="true" className={className} {...props}>
      <SkeletonLine width="30%" className="min-h-5 text-body" />
      {Array.from({ length: fields }, (_, field) => (
        <div key={field} className="grid gap-2">
          <SkeletonLine width="22%" className="text-body-sm" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </Zone>
  );
}

function SkeletonBanner({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <Zone data-slot="skeleton-banner" aria-hidden="true" className={className} {...props}>
      <div className="flex items-start gap-3">
        <Skeleton className="mt-0.5 size-5 rounded-full" />
        <div className="grid flex-1">
          <SkeletonLine width="55%" className="text-body" />
          <SkeletonLine width="35%" className="text-body-sm" />
        </div>
      </div>
    </Zone>
  );
}

const sheetLines = ["100%", "92%", "100%", "84%", "96%", "62%"];

function SkeletonSheet({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton-sheet"
      aria-hidden="true"
      className={cn(
        "grid aspect-[595/842] w-full max-w-[595px] content-start gap-4 overflow-hidden rounded-sm bg-white px-10 py-9 shadow-pop",
        className,
      )}
      {...props}
    >
      <span className="block h-4 w-2/5 rounded-sm bg-black/10 motion-safe:animate-pulse" />
      {[0, 1, 2].map((block) => (
        <div key={block} className="grid gap-2">
          <span className="block h-2.5 w-1/4 rounded-sm bg-black/10 motion-safe:animate-pulse" />
          {sheetLines.map((width, line) => (
            <span
              key={line}
              className="block h-2 rounded-sm bg-black/5 motion-safe:animate-pulse"
              style={{ width }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

type SkeletonFormZoneProps = React.ComponentProps<"div"> & {
  label: string;
  rows?: number;
};

function SkeletonFormZone({ label, rows = 3, className, ...props }: SkeletonFormZoneProps) {
  return (
    <div role="status" data-slot="skeleton-form-zone" className={cn("grid", className)} {...props}>
      <span className="sr-only">{label}</span>
      <Zone aria-hidden="true">
        <div className="grid gap-0.5">
          <SkeletonLine width="22%" className="text-body" />
          <SkeletonLine width="62%" className="text-body-sm" />
        </div>
        <div className="grid grid-cols-[200px_minmax(0,1fr)] items-start gap-x-4 gap-y-4 text-body-sm">
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="contents">
              <SkeletonLine width="70%" className="mt-1.5" />
              <div className="grid justify-items-start gap-1.5">
                <Skeleton className="h-8 w-48" />
                <SkeletonLine
                  width={columnWidths[row % columnWidths.length] ?? "50%"}
                  className="text-caption"
                />
              </div>
            </div>
          ))}
        </div>
      </Zone>
    </div>
  );
}

type SkeletonZonesProps = React.ComponentProps<"div"> & {
  label: string;
  count?: number;
  columns?: 1 | 2;
  fields?: number;
  stats?: boolean;
};

function SkeletonZones({
  label,
  count = 4,
  columns = 2,
  fields = 3,
  stats = false,
  className,
  ...props
}: SkeletonZonesProps) {
  return (
    <div
      role="status"
      data-slot="skeleton-zones"
      className={cn("grid gap-(--space-zone)", className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
      {stats ? (
        <div
          aria-hidden="true"
          data-slot="skeleton-stat-strip"
          className="grid grid-cols-4 rounded-zone border border-surf-edge bg-surf-section px-(--pad-zone) py-5"
        >
          {[0, 1, 2, 3].map((stat) => (
            <div
              key={stat}
              className="grid min-w-0 gap-0.75 border-l border-line px-4.5 first:border-l-0 first:pl-0"
            >
              <SkeletonLine width="40%" className="text-page-title leading-[1.1]" />
              <SkeletonLine width="60%" className="text-body-sm" />
              <SkeletonLine width="50%" className="text-caption" />
            </div>
          ))}
        </div>
      ) : null}
      <div
        aria-hidden="true"
        className={cn("grid gap-(--space-zone)", columns === 2 && "grid-cols-2")}
      >
        {Array.from({ length: count }, (_, zone) => (
          <SkeletonZone key={zone} fields={fields} />
        ))}
      </div>
    </div>
  );
}

type SkeletonTableRowsProps = {
  label: string;
  rows?: number;
  columns: number;
};

function SkeletonTableRows({ label, rows = 5, columns }: SkeletonTableRowsProps) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <TableRow
          key={row}
          data-slot={row === 0 ? "skeleton-rows" : "skeleton-row"}
          aria-hidden={row === 0 ? undefined : "true"}
          style={{ opacity: 1 - row * (0.6 / Math.max(rows, 1)) }}
        >
          {Array.from({ length: columns }, (_, column) => (
            <TableCell key={column}>
              {row === 0 && column === 0 ? (
                <span role="status" className="sr-only">
                  {label}
                </span>
              ) : null}
              <SkeletonLine
                width={columnWidths[(row + column) % columnWidths.length] ?? "50%"}
                className="max-w-full"
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export type {
  SkeletonFormZoneProps,
  SkeletonTableRowsProps,
  SkeletonZoneProps,
  SkeletonZonesProps,
};
export {
  SkeletonBanner,
  SkeletonFormZone,
  SkeletonSheet,
  SkeletonTableRows,
  SkeletonZone,
  SkeletonZones,
};
