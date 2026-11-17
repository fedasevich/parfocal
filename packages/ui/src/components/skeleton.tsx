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

export type { SkeletonRowsProps };
export { Skeleton, SkeletonLine, SkeletonRows };
