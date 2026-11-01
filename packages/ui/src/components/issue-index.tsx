import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type IssueState = { id: string; text: string; ready?: boolean };

type IssueGroup = { flow: string; states: IssueState[] };

type IssueIndexProps = Omit<React.ComponentProps<"div">, "onSelect"> & {
  groups: IssueGroup[];
  onOpen?: (id: string) => void;
};

function IssueIndex({ groups, onOpen, className, ...props }: IssueIndexProps) {
  const total = groups.reduce((sum, group) => sum + group.states.length, 0);
  return (
    <div data-slot="issue-index" className={cn("grid gap-5", className)} {...props}>
      <p className="m-0 text-body-sm text-fg-dim">
        {total} states in {groups.length} flows.
      </p>
      {groups.map((group) => (
        <section key={group.flow} className="grid gap-2">
          <h3 className="m-0 text-body font-semibold">{group.flow}</h3>
          <div className="grid gap-1.5">
            {group.states.map((state) => (
              <button
                key={state.id}
                type="button"
                aria-disabled={state.ready === false || undefined}
                title={state.ready === false ? "Its screen is not built yet" : undefined}
                onClick={() => (state.ready === false ? undefined : onOpen?.(state.id))}
                className={cn(
                  "grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_16px] items-center gap-2.5 rounded-ctl border border-line bg-surf-section px-3 py-2 text-left text-body-sm text-fg hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent",
                  state.ready === false && "cursor-not-allowed opacity-45",
                )}
              >
                <Icon name="warn" className="text-warn" />
                <span>{state.text}</span>
                <Icon name="next" className="text-fg-faint" />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export { type IssueGroup, IssueIndex, type IssueIndexProps, type IssueState };
