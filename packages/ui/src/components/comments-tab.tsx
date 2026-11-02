import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { Person, type PersonInfo } from "@parfocal/ui/components/person";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { ObjectIdTag } from "@parfocal/ui/components/tag";
import {
  countThreads,
  emptyThreadsLine,
  filterThreads,
  type ThreadFilter,
} from "@parfocal/ui/lib/comment-threads";
import { cn } from "@parfocal/ui/lib/utils";
import * as React from "react";

type CommentThreadCard = {
  id: string;
  anchor: string;
  kind: string;
  title: string;
  author?: PersonInfo | undefined;
  messages: number;
  at: string;
  resolved: boolean;
};

type CommentsTabProps = Omit<React.ComponentProps<"div">, "onSelect"> & {
  threads: CommentThreadCard[];
  selectedId?: string | undefined;
  filter?: ThreadFilter;
  defaultFilter?: ThreadFilter;
  onFilterChange?: (filter: ThreadFilter) => void;
  onSelect?: (id: string) => void;
  onGoTo?: (id: string) => void;
  onNewComment?: () => void;
  slideLabel?: string;
};

function ThreadCardRow({
  thread,
  selected,
  onSelect,
  onGoTo,
}: {
  thread: CommentThreadCard;
  selected: boolean;
  onSelect: (() => void) | undefined;
  onGoTo: (() => void) | undefined;
}) {
  return (
    <li
      data-slot="thread-card"
      data-resolved={thread.resolved || undefined}
      data-selected={selected || undefined}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-1 rounded-zone border border-transparent p-1 hover:bg-chrome-2",
        selected && "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-surf-hl",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="grid min-w-0 cursor-pointer gap-1.5 rounded-ctl border-0 bg-transparent p-1.5 text-left text-fg outline-none focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="flex items-center gap-2.5">
          <ObjectIdTag>{thread.anchor}</ObjectIdTag>
          <b className="min-w-0 flex-1 truncate text-body-sm font-semibold">{thread.kind}</b>
          {thread.resolved ? (
            <span className="inline-flex items-center gap-1 text-caption text-ok">
              <Icon name="check" size="xs" />
              Resolved
            </span>
          ) : null}
        </span>
        <span className="text-body-sm text-fg">{thread.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-fg-dim">
          {thread.author ? <Person person={thread.author} size={20} /> : null}
          <span aria-hidden="true">·</span>
          <span className="inline-flex shrink-0 items-center gap-1 font-mono">
            <Icon name="comment" size="xs" />
            {thread.messages}
          </span>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">{thread.at}</span>
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Go to ${thread.anchor}`}
        title={`Go to ${thread.anchor}`}
        onClick={onGoTo}
      >
        <Icon name="target" />
      </Button>
    </li>
  );
}

function CommentsTab({
  threads,
  selectedId,
  filter: controlled,
  defaultFilter = "open",
  onFilterChange,
  onSelect,
  onGoTo,
  onNewComment,
  slideLabel,
  className,
  ...props
}: CommentsTabProps) {
  const [own, setOwn] = React.useState<ThreadFilter>(defaultFilter);
  const filter = controlled ?? own;
  const counts = countThreads(threads);
  const shown = filterThreads(threads, filter);
  const change = (next: ThreadFilter) => {
    setOwn(next);
    onFilterChange?.(next);
  };
  return (
    <div
      data-slot="comments-tab"
      className={cn("grid min-w-0 content-start gap-3", className)}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-body-sm font-semibold">
          {slideLabel ? `Threads on ${slideLabel}` : "Threads"}
        </span>
        <SegmentedControl
          aria-label="Show threads"
          value={filter}
          onValueChange={(next) => change(next === "resolved" ? "resolved" : "open")}
          options={[
            { value: "open", label: `Open ${counts.open}` },
            { value: "resolved", label: `Resolved ${counts.resolved}` },
          ]}
        />
      </div>
      {shown.length ? (
        <ul className="m-0 grid list-none gap-1 p-0">
          {shown.map((thread) => (
            <ThreadCardRow
              key={thread.id}
              thread={thread}
              selected={thread.id === selectedId}
              onSelect={onSelect ? () => onSelect(thread.id) : undefined}
              onGoTo={onGoTo ? () => onGoTo(thread.id) : undefined}
            />
          ))}
        </ul>
      ) : (
        <p data-slot="threads-empty" className="m-0 text-body-sm text-fg-dim">
          {emptyThreadsLine(filter, counts[filter === "open" ? "resolved" : "open"])}
        </p>
      )}
      <Button block onClick={onNewComment}>
        <Icon name="comment" />
        New comment <Keycap keys="C" size="sm" />
      </Button>
    </div>
  );
}

export { CommentsTab, type CommentsTabProps, type CommentThreadCard };
