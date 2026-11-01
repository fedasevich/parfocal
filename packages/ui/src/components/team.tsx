import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Person, type PersonInfo } from "@parfocal/ui/components/person";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import { StatusTag, type StatusTone } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";
import { useState } from "react";

type ReviewerStatus = "on-track" | "behind" | "not-started" | "away" | "done";

const statusWords: Record<ReviewerStatus, string> = {
  "on-track": "On track",
  behind: "Behind",
  "not-started": "Not started",
  away: "Away",
  done: "Done",
};

const statusTones: Record<ReviewerStatus, StatusTone> = {
  "on-track": "ok",
  behind: "warn",
  "not-started": "neutral",
  away: "neutral",
  done: "accent",
};

type ReviewerRowProps = React.ComponentProps<"div"> & {
  person: PersonInfo;
  done: number;
  of: number;
  last: string;
  status: ReviewerStatus;
  awayUntil?: string;
  you?: boolean;
  nudged?: boolean;
  onNudge?: () => void;
  onReassign?: () => void;
};

function ReviewerRow({
  person,
  done,
  of,
  last,
  status,
  awayUntil,
  you = false,
  nudged = false,
  onNudge,
  onReassign,
  className,
  ...props
}: ReviewerRowProps) {
  return (
    <div
      data-slot="reviewer-row"
      data-status={status}
      className={cn(
        "grid grid-cols-[minmax(0,220px)_minmax(0,1fr)_140px_auto_auto] items-center gap-4 border-t border-line py-2.5 text-body-sm first:border-t-0",
        className,
      )}
      {...props}
    >
      <Person person={person} you={you} />
      <ProgressBar
        value={of === 0 ? 0 : (done / of) * 100}
        aria-label={`${person.name}: ${done} of ${of} slides`}
        tone={status === "done" ? "ok" : status === "behind" ? "warn" : "accent"}
        valueText={`${done} of ${of}`}
        label={nudged ? "nudged just now" : last}
      />
      <span>
        <StatusTag tone={statusTones[status]}>
          {status === "away" && awayUntil ? `Away until ${awayUntil}` : statusWords[status]}
        </StatusTag>
      </span>
      {status === "done" || you ? (
        <span />
      ) : (
        <Button size="sm" onClick={onNudge} disabled={nudged}>
          Nudge
        </Button>
      )}
      {status === "done" || you ? (
        <span />
      ) : (
        <Button size="sm" variant="ghost" onClick={onReassign}>
          Reassign
        </Button>
      )}
    </div>
  );
}

type TaskBlockProps = Omit<React.ComponentProps<"section">, "title"> & {
  title: string;
  project: string;
  due: string;
  dueIn: string;
  overdue?: boolean;
};

function TaskBlock({
  title,
  project,
  due,
  dueIn,
  overdue = false,
  className,
  children,
  ...props
}: TaskBlockProps) {
  return (
    <section
      data-slot="task-block"
      className={cn(
        "grid gap-2 rounded-zone border border-surf-edge bg-surf-section p-(--pad-zone)",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <h3 className="m-0 text-body font-semibold">{title}</h3>
          <small className="text-caption text-fg-dim">{project}</small>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-body-sm",
            overdue ? "text-bad" : "text-fg-dim",
          )}
        >
          <Icon name="calendar" />
          Due {due} · {dueIn}
        </span>
      </div>
      <div>{children}</div>
    </section>
  );
}

type ConfirmInButtonProps = {
  label: string;
  question: string;
  confirm: string;
  onConfirm?: () => void;
};

function ConfirmInButton({ label, question, confirm, onConfirm }: ConfirmInButtonProps) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button onClick={() => setAsking(true)}>
        <Icon name="bell" />
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-ctl border border-line-strong bg-btn-bg py-0.5 pr-0.5 pl-3 text-body-sm">
      {question}
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
        Cancel
      </Button>
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          onConfirm?.();
          setAsking(false);
        }}
      >
        {confirm}
      </Button>
    </span>
  );
}

export {
  ConfirmInButton,
  type ConfirmInButtonProps,
  ReviewerRow,
  type ReviewerRowProps,
  type ReviewerStatus,
  TaskBlock,
  type TaskBlockProps,
};
