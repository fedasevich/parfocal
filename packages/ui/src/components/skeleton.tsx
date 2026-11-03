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

export { Skeleton, SkeletonLine };
