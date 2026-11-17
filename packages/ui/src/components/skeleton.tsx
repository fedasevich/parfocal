import { cn } from "@parfocal/ui/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("rounded-md bg-chrome-2 motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}

type SkeletonLineProps = React.ComponentProps<"span"> & { width?: string };

function SkeletonLine({ width = "100%", className, style, ...props }: SkeletonLineProps) {
  return (
    <span
      data-slot="skeleton-line"
      aria-hidden="true"
      className={cn("flex h-lh items-center", className)}
      style={{ width, ...style }}
      {...props}
    >
      <span className="block h-[0.7em] w-full rounded-sm bg-chrome-2 motion-safe:animate-pulse" />
    </span>
  );
}

type SkeletonRowsProps = React.ComponentProps<"div"> & {
  label: string;
  rows?: number;
  columns?: number;
};

const columnWidths = ["72%", "48%", "60%", "36%"];

function SkeletonRows({ label, rows = 5, columns = 3, className, ...props }: SkeletonRowsProps) {
  return (
    <div
      role="status"
      data-slot="skeleton-rows"
      className={cn("grid w-full", className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          aria-hidden="true"
          className="grid items-center gap-4 border-b border-line px-4 py-2.5 last:border-b-0"
          style={{
            gridTemplateColumns: `2fr repeat(${Math.max(columns - 1, 0)}, 1fr)`,
            opacity: 1 - row * (0.6 / Math.max(rows, 1)),
          }}
        >
          {Array.from({ length: columns }, (_, column) => (
            <SkeletonLine
              key={column}
              width={columnWidths[(row + column) % columnWidths.length] ?? "50%"}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

type SkeletonCardsProps = React.ComponentProps<"div"> & {
  label: string;
  cards?: number;
  minWidth?: string;
};

function SkeletonCards({
  label,
  cards = 6,
  minWidth = "240px",
  className,
  style,
  ...props
}: SkeletonCardsProps) {
  return (
    <div
      role="status"
      data-slot="skeleton-cards"
      className={cn("grid w-full gap-3", className)}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}, 1fr))`, ...style }}
      {...props}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: cards }, (_, card) => (
        <div
          key={card}
          aria-hidden="true"
          className="grid gap-2 rounded-zone border border-line bg-surf-panel p-4"
        >
          <SkeletonLine width={columnWidths[card % columnWidths.length] ?? "60%"} />
          <SkeletonLine width="90%" />
          <SkeletonLine width="40%" />
        </div>
      ))}
    </div>
  );
}

type SkeletonPanelProps = React.ComponentProps<"div"> & {
  label: string;
  sections?: number;
};

function SkeletonPanel({ label, sections = 3, className, ...props }: SkeletonPanelProps) {
  return (
    <div
      role="status"
      data-slot="skeleton-panel"
      className={cn("grid w-full content-start gap-5 p-4", className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
      <SkeletonLine width="45%" className="text-title" />
      {Array.from({ length: sections }, (_, section) => (
        <div key={section} aria-hidden="true" className="grid gap-2">
          <SkeletonLine width="30%" />
          <Skeleton className="h-9 w-full" />
          <SkeletonLine width={columnWidths[section % columnWidths.length] ?? "60%"} />
        </div>
      ))}
    </div>
  );
}

export type { SkeletonCardsProps, SkeletonPanelProps, SkeletonRowsProps };
export { Skeleton, SkeletonCards, SkeletonLine, SkeletonPanel, SkeletonRows };
