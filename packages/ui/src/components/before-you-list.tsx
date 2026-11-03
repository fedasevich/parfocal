import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";
import * as React from "react";

type Blocker = {
  id: string;
  text: React.ReactNode;
  goTo: string;
  target?: string;
  onGoTo?: () => void;
};

function focusTarget(target: string) {
  const node = document.querySelector<HTMLElement>(target);
  if (!node) return false;
  if (node.tabIndex < 0 && !node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
  node.scrollIntoView?.({ block: "nearest" });
  node.focus();
  return document.activeElement === node;
}

function goToBlocker(blocker: Blocker) {
  blocker.onGoTo?.();
  if (blocker.target) focusTarget(blocker.target);
}

type BeforeYouListProps = Omit<React.ComponentProps<"div">, "title"> & {
  title?: string;
  blockers: Blocker[];
  showSingle?: boolean;
};

function BeforeYouList({
  title = "Before you can",
  blockers,
  showSingle = false,
  className,
  ...props
}: BeforeYouListProps) {
  const titleId = React.useId();
  if (blockers.length < (showSingle ? 1 : 2)) return null;
  return (
    <div
      data-slot="before-you-list"
      className={cn(
        "grid gap-1 rounded-zone border border-surf-edge bg-surf-section px-3.5 py-3",
        className,
      )}
      {...props}
    >
      <b id={titleId} className="mb-1 text-body-sm font-semibold">
        {title}
      </b>
      <ul aria-labelledby={titleId} className="m-0 grid list-none gap-1.5 p-0">
        {blockers.map((blocker) => (
          <li
            key={blocker.id}
            className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2.5 text-body-sm leading-[1.45] text-fg"
          >
            <Icon name="warn" className="mt-0.5 text-warn" />
            <span id={`${titleId}-${blocker.id}`}>{blocker.text}</span>
            <button
              type="button"
              aria-describedby={`${titleId}-${blocker.id}`}
              onClick={() => goToBlocker(blocker)}
              className="cursor-pointer border-0 bg-transparent p-0 text-body-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent"
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

export {
  BeforeYouList,
  type BeforeYouListProps,
  type Blocker,
  blockerReason,
  focusTarget,
  goToBlocker,
};
