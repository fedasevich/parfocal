import { useLingui } from "@lingui/react/macro";
import { Skeleton, SkeletonLine } from "@parfocal/ui/components/skeleton";

const popoverRows = 5;

function NotificationsSkeleton() {
  const { t } = useLingui();

  return (
    <div
      role="status"
      data-testid="notifications-skeleton"
      className="flex max-h-[780px] min-h-0 flex-col"
    >
      <span className="sr-only">{t`Loading notifications`}</span>
      <div aria-hidden="true" className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <SkeletonLine width="38%" className="text-lead" />
        <Skeleton className="h-5 w-24" />
      </div>
      <div aria-hidden="true" className="px-4 pb-2.5">
        <Skeleton className="h-8 w-full" />
      </div>
      <div aria-hidden="true" className="min-h-0 overflow-hidden border-line border-t">
        {Array.from({ length: popoverRows }, (_, row) => (
          <div
            key={row}
            data-testid="notifications-skeleton-row"
            className="grid grid-cols-[10px_30px_1fr_auto] items-start gap-2.5 border-line border-b px-4 py-3"
            style={{ opacity: 1 - row * 0.1 }}
          >
            <span />
            <Skeleton className="size-7.5 rounded-full" />
            <div className="min-w-0">
              <SkeletonLine width="70%" className="text-body-sm" />
              <SkeletonLine width="50%" className="mt-0.5 text-body-sm" />
              {row === 0 || row === 2 ? (
                <SkeletonLine width="40%" className="text-body-sm" />
              ) : null}
              <Skeleton className="mt-3 mb-px h-7 w-16" />
            </div>
            <SkeletonLine width="2rem" className="text-caption" />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="flex items-center justify-between px-4 py-3">
        <SkeletonLine width="5rem" />
        <SkeletonLine width="4rem" />
      </div>
    </div>
  );
}

export { NotificationsSkeleton, popoverRows };
