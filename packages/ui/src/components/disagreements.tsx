import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { ObjectIdTag, StatusTag } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type QueueTagTone = NonNullable<React.ComponentProps<typeof StatusTag>["tone"]>;

type QueueRowProps = Omit<React.ComponentProps<"div">, "onSelect"> & {
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
      <span className="min-w-0 truncate text-left">{slide}</span>
      <StatusTag {...(tone ? { tone } : {})}>{tag}</StatusTag>
    </>
  );
  const grid = "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5";
  return (
    <div
      data-slot="queue-row"
      data-selected={selected || undefined}
      data-done={done || undefined}
      aria-disabled={locked || undefined}
      className={cn(
        "grid min-h-11 grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-ctl px-3 text-body-sm text-fg",
        selected
          ? "bg-surf-panel shadow-[inset_0_0_0_1px_var(--line-strong)] dark:bg-chrome-2 dark:shadow-none"
          : "hover:bg-surf-panel dark:hover:bg-chrome-2/60",
        locked && "grid-cols-1 opacity-55",
        className,
      )}
      {...props}
    >
      {locked ? null : (
        <Checkbox
          aria-label={`Select ${object} on ${slide}`}
          checked={checked}
          disabled={!checkable}
          title={checkable ? undefined : checkReason}
          className="m-1"
          onCheckedChange={(next) => onCheckedChange?.(next === true)}
        />
      )}
      {locked || onSelect === undefined ? (
        <div className={cn(grid, done && "text-fg-dim")}>{content}</div>
      ) : (
        <button
          type="button"
          aria-current={selected || undefined}
          onClick={onSelect}
          className={cn(
            grid,
            "min-h-11 cursor-pointer border-0 bg-transparent p-0 text-body-sm text-fg focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent",
            done && "text-fg-dim",
          )}
        >
          {content}
        </button>
      )}
    </div>
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
        "grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] items-start gap-x-3 rounded-ctl border border-line bg-surf-panel px-3 py-2.5 text-body-sm dark:border-transparent dark:bg-chrome-2",
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
      {children}
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
  QuotedNote,
  ReadinessList,
  ReadinessRow,
  type ReadinessRowProps,
};
