import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "cn";
import type * as React from "react";

type Blocker = {
  id: string;
  text: React.ReactNode;
  goTo: string;
  onGoTo?: () => void;
};

type BeforeYouListProps = Omit<React.ComponentProps<"div">, "title"> & {
  title?: string;
  blockers: Blocker[];
};

function BeforeYouList({
  title = "Before you can",
  blockers,
  className,
  ...props
}: BeforeYouListProps) {
  if (blockers.length < 2) return null;
  return (
    <div
      data-slot="before-you-list"
      className={cn(
        "grid gap-1 rounded-zone border border-surf-edge bg-surf-section px-3.5 py-3",
        className,
      )}
      {...props}
    >
      <b className="mb-1 text-body-sm font-semibold">{title}</b>
      <ul aria-label={title} className="m-0 grid list-none gap-1.5 p-0">
        {blockers.map((blocker) => (
          <li
            key={blocker.id}
            className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2.5 text-body-sm leading-[1.45] text-fg"
          >
            <Icon name="warn" className="mt-0.5 text-warn" />
            <span>{blocker.text}</span>
            <button
              type="button"
              onClick={blocker.onGoTo}
              className="cursor-pointer border-0 bg-transparent p-0 text-body-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {blocker.goTo}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function blockerReason(blockers: Blocker[]) {
  if (blockers.length !== 1) return undefined;
  const [only] = blockers;
  return typeof only?.text === "string" ? `${only.text}.` : undefined;
}

export { BeforeYouList, type BeforeYouListProps, type Blocker, blockerReason };
