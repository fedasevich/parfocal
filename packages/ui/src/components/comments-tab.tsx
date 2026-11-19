import { Trans, useLingui } from "@lingui/react/macro";
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
  scope?: string | undefined;
  title: string;
  author?: PersonInfo | undefined;
  messages: number;
  at: string;
  resolved: boolean;
};

type DecisionNoteCard = {
  id: string;
  anchor: string;
  decision: string;
  author?: PersonInfo | undefined;
  text: string;
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
  notes?: DecisionNoteCard[] | undefined;
  onSelectNote?: ((id: string) => void) | undefined;
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
  const { t } = useLingui();

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
        className="grid min-w-0 cursor-pointer gap-1.5 rounded-ctl border-0 bg-transparent p-1.5 text-left text-fg outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent"
      >
        <span className="flex items-center gap-2.5">
          <ObjectIdTag>{thread.anchor}</ObjectIdTag>
          <b className="min-w-0 flex-1 truncate text-body-sm font-semibold">{thread.kind}</b>
          {thread.scope ? (
            <span
              data-slot="thread-scope"
              className="max-w-28 shrink-0 truncate rounded-ctl border border-line px-1.5 text-caption text-fg-dim"
            >
              {thread.scope}
            </span>
          ) : null}
          {thread.resolved ? (
            <span className="inline-flex items-center gap-1 text-caption text-ok">
              <Icon name="check" size="xs" />
              <Trans>Resolved</Trans>
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
        aria-label={t`Go to ${thread.anchor}`}
        title={t`Go to ${thread.anchor}`}
        onClick={onGoTo}
      >
        <Icon name="target" />
      </Button>
    </li>
  );
}

function DecisionNoteRow({
  note,
  onSelect,
}: {
  note: DecisionNoteCard;
  onSelect: (() => void) | undefined;
}) {
  return (
    <li data-slot="decision-note-card">
      <button
        type="button"
        onClick={onSelect}
        className="grid w-full min-w-0 cursor-pointer gap-1.5 rounded-zone border border-transparent bg-transparent p-2 text-left text-fg outline-none hover:bg-chrome-2 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent"
      >
        <span className="flex items-center gap-2.5">
          <ObjectIdTag>{note.anchor}</ObjectIdTag>
          <b className="min-w-0 flex-1 truncate text-body-sm font-semibold">{note.decision}</b>
        </span>
        <span className="flex items-start gap-2 text-body-sm text-fg">
          {note.author ? <Person person={note.author} size={20} /> : null}
          <span className="min-w-0 flex-1" data-phi="">
            {note.text}
          </span>
        </span>
      </button>
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
  notes = [],
  onSelectNote,
  slideLabel,
  className,
  ...props
}: CommentsTabProps) {
  const { t } = useLingui();

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
        <span className="text-body-sm font-semibold" data-phi="">
          {slideLabel ? t`Threads on ${slideLabel}` : t`Threads`}
        </span>
        <SegmentedControl
          aria-label={t`Show threads`}
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
        <Trans>
          New comment on an ID <Keycap keys="C" size="sm" />
        </Trans>
      </Button>
      {notes.length ? (
        <section
          data-slot="decision-notes"
          aria-label={t`Your decision notes`}
          className="grid gap-1"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-body-sm font-semibold">
              <Trans>Your decision notes</Trans>
            </span>
            <span className="font-mono text-caption text-fg-dim">{notes.length}</span>
          </div>
          <ul className="m-0 grid list-none gap-1 p-0">
            {notes.map((note) => (
              <DecisionNoteRow
                key={note.id}
                note={note}
                onSelect={onSelectNote ? () => onSelectNote(note.id) : undefined}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export { CommentsTab, type CommentsTabProps, type CommentThreadCard, type DecisionNoteCard };
