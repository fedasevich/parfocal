import { useLingui } from "@lingui/react/macro";
import { Skeleton, SkeletonLine } from "@parfocal/ui/components/skeleton";
import { cn } from "@parfocal/ui/lib/utils";

const lastLineWidth = "62%";

type CommentThreadSkeletonProps = Omit<React.ComponentProps<"div">, "children"> & {
  lines?: readonly number[] | undefined;
};

function CommentThreadSkeleton({
  lines = [2, 2, 3],
  className,
  ...props
}: CommentThreadSkeletonProps) {
  const { t } = useLingui();

  return (
    <div
      role="status"
      data-slot="comment-thread-skeleton"
      className={cn("grid gap-3.5", className)}
      {...props}
    >
      <span className="sr-only">{t`Loading the messages`}</span>
      {lines.map((count, message) => (
        <div
          key={message}
          aria-hidden="true"
          data-slot="comment-skeleton"
          className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5"
          style={{ opacity: 1 - message * 0.15 }}
        >
          <Skeleton className="mt-0.5 size-5.5 rounded-full" />
          <div className="grid gap-1">
            <SkeletonLine width="40%" className="text-body-sm" />
            <div>
              {Array.from({ length: Math.max(count, 1) }, (_, line) => (
                <SkeletonLine
                  key={line}
                  width={line === count - 1 && count > 1 ? lastLineWidth : "100%"}
                  className="text-body-sm leading-[1.45]"
                />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export { CommentThreadSkeleton, type CommentThreadSkeletonProps };
