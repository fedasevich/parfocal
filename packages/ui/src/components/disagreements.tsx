import { MentionText } from "@parfocal/ui/components/comment-thread";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import {
  Table,
  TableBody,
  TableCell,
  TablePickCell,
  TableRow,
} from "@parfocal/ui/components/table";
import { ObjectIdTag, StatusTag } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type QueueTagTone = NonNullable<React.ComponentProps<typeof StatusTag>["tone"]>;

type QueueRowProps = Omit<React.ComponentProps<"tr">, "onSelect"> & {
  object: string;
  slide: string;
  tag: React.ReactNode;
  tone?: QueueTagTone | undefined;
  selected?: boolean | undefined;
  done?: boolean | undefined;
  locked?: boolean | undefined;
  checked?: boolean | undefined;
  checkable?: boolean | undefined;
  checkReason?: string | undefined;
  onSelect?: (() => void) | undefined;
  onCheckedChange?: ((checked: boolean) => void) | undefined;
};

function QueueTable({ className, children, ...props }: React.ComponentProps<"table">) {
  return (
    <Table className={cn("border-separate border-spacing-y-1", className)} {...props}>
      <TableBody className="[&_tr]:border-0">{children}</TableBody>
    </Table>
  );
}

function QueueRow({
  object,
  slide,
  tag,
  tone,
  selected = false,
  done = false,
  locked = false,
  checked = false,
  checkable = true,
  checkReason = "Already decided or with the adjudicator",
  onSelect,
  onCheckedChange,
  className,
  ...props
}: QueueRowProps) {
  const content = (
    <>
      <ObjectIdTag>{object}</ObjectIdTag>
      <span className="min-w-0 truncate text-left" data-phi="">
        {slide}
      </span>
    </>
  );
  const grid = "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5";
  return (
    <TableRow
      data-slot="queue-row"
      data-selected={selected || undefined}
      data-done={done || undefined}
      aria-disabled={locked || undefined}
      className={cn(
        "h-11 text-body-sm text-fg [&>td]:p-0 [&>td]:text-fg [&>td:first-child]:rounded-l-ctl [&>td:first-child]:pl-3 [&>td:last-child]:rounded-r-ctl [&>td:last-child]:pr-3",
        selected
          ? "[&>td]:bg-surf-panel dark:[&>td]:bg-chrome-2"
          : "hover:[&>td]:bg-surf-panel dark:hover:[&>td]:bg-chrome-2/60",
        locked && "opacity-55",
        className,
      )}
      {...props}
    >
      {locked ? null : (
        <TablePickCell
          label={`Select ${object} on ${slide}`}
          picked={checked}
          disabled={!checkable}
          reason={checkReason}
          className="w-9"
          boxClassName="m-1"
          onToggle={() => onCheckedChange?.(!checked)}
        />
      )}
      <TableCell className={cn("w-full max-w-0 px-0", done && "text-fg-dim")}>
        {locked || onSelect === undefined ? (
          <div className={cn(grid, "px-1", locked && "pl-3")}>{content}</div>
        ) : (
          <button
            type="button"
            aria-current={selected || undefined}
            onClick={onSelect}
            className={cn(
              grid,
              "min-h-11 w-full cursor-pointer border-0 bg-transparent p-0 text-body-sm text-fg focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent",
              done && "text-fg-dim",
            )}
          >
            {content}
          </button>
        )}
      </TableCell>
      <TableCell className="text-right">
        <StatusTag {...(tone ? { tone } : {})}>{tag}</StatusTag>
      </TableCell>
    </TableRow>
  );
}

function EvidenceList({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="evidence-list" className={cn("grid gap-2", className)} {...props} />;
}

type EvidenceRowProps = Omit<React.ComponentProps<"div">, "title"> & {
  icon?: IconName;
  title: React.ReactNode;
};

function EvidenceRow({ icon, title, className, children, ...props }: EvidenceRowProps) {
  return (
    <div
      data-slot="evidence-row"
      className={cn(
        "grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] items-start gap-x-3 rounded-ctl border border-line bg-surf-panel px-3 py-(--density-item-y) text-body-sm dark:border-transparent dark:bg-chrome-2",
        className,
      )}
      {...props}
    >
      <b className="flex min-w-0 items-center gap-2 font-semibold text-fg">
        {icon ? <Icon name={icon} className="shrink-0 text-fg-dim" /> : null}
        <span className="min-w-0 truncate">{title}</span>
      </b>
      <div className="grid min-w-0 justify-items-start gap-1.5 text-fg">{children}</div>
    </div>
  );
}

function QuotedNote({ className, children, ...props }: React.ComponentProps<"q">) {
  return (
    <q
      data-slot="quoted-note"
      className={cn(
        "block border-l-2 border-line-strong pl-3 text-body-sm leading-[1.45] text-fg",
        className,
      )}
      {...props}
    >
      {typeof children === "string" ? <MentionText text={children} /> : children}
    </q>
  );
}

type ReadinessRowProps = Omit<React.ComponentProps<"li">, "title"> & {
  tone: "ok" | "warn";
  title: React.ReactNode;
  sub?: React.ReactNode;
  action?: React.ReactNode;
};

function ReadinessRow({ tone, title, sub, action, className, ...props }: ReadinessRowProps) {
  return (
    <li
      data-slot="readiness-row"
      data-tone={tone}
      className={cn(
        "grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-2.5 text-body-sm leading-[1.45]",
        className,
      )}
      {...props}
    >
      <Icon
        name={tone === "ok" ? "check" : "warn"}
        className={cn("mt-0.5", tone === "ok" ? "text-ok" : "text-warn")}
      />
      <span className="grid min-w-0 gap-0.5">
        <b className="font-semibold text-fg">{title}</b>
        {sub ? <span className="text-fg">{sub}</span> : null}
      </span>
      {action ?? <span />}
    </li>
  );
}

function ReadinessList({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="readiness-list"
      className={cn("m-0 grid list-none gap-3 p-0", className)}
      {...props}
    />
  );
}

type ProgressDotsProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  items: { key: string; label: string; value: "agree" | "disagree" | "unsure" | null }[];
  current: number;
  onJump?: (index: number) => void;
  summary?: React.ReactNode;
};

const dotTone = {
  agree: "border-ok bg-ok text-on-accent",
  disagree: "border-bad bg-bad text-on-accent",
  unsure: "border-warn bg-warn text-on-accent",
};

function ProgressDots({ items, current, onJump, summary, className, ...props }: ProgressDotsProps) {
  return (
    <div
      data-slot="progress-dots"
      className={cn("flex items-center gap-2 text-body-sm", className)}
      {...props}
    >
      {items.map((item, index) => (
        <button
          key={item.key}
          type="button"
          aria-label={`${item.label}, ${item.value ?? "not decided yet"}`}
          aria-current={index === current || undefined}
          onClick={() => onJump?.(index)}
          className={cn(
            "grid size-5 cursor-pointer place-items-center rounded-full border-2 border-line-strong bg-transparent p-0 text-label font-bold",
            item.value ? dotTone[item.value] : "",
            "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4 focus-visible:outline-accent",
            index === current && "outline-2 outline-solid outline-offset-2 outline-accent",
          )}
        >
          {item.value === "agree" ? (
            <Icon name="check" size="xs" />
          ) : item.value === "disagree" ? (
            <Icon name="close" size="xs" />
          ) : item.value === "unsure" ? (
            "?"
          ) : null}
        </button>
      ))}
      {summary ? <em className="ml-1 text-caption not-italic text-fg-dim">{summary}</em> : null}
    </div>
  );
}

export {
  EvidenceList,
  EvidenceRow,
  type EvidenceRowProps,
  ProgressDots,
  type ProgressDotsProps,
  QueueRow,
  type QueueRowProps,
  QueueTable,
  QuotedNote,
  ReadinessList,
  ReadinessRow,
  type ReadinessRowProps,
};
