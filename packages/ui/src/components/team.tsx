import { Button } from "@parfocal/ui/components/button";
import { FormField } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { AvatarStack, Person, type PersonInfo } from "@parfocal/ui/components/person";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import { RadioGroup, RadioGroupItem } from "@parfocal/ui/components/radio-group";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { StatusTag, type StatusTone } from "@parfocal/ui/components/tag";
import { TokenField, type TokenItem } from "@parfocal/ui/components/token-field";
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
  done: "ok",
};

type ReviewerRowProps = React.ComponentProps<"div"> & {
  person: PersonInfo;
  done: number;
  of: number;
  last: string;
  status: ReviewerStatus;
  awayUntil?: string | undefined;
  you?: boolean;
  nudged?: boolean;
  highlight?: boolean;
  hint?: React.ReactNode;
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
  highlight = false,
  hint,
  onNudge,
  onReassign,
  className,
  ...props
}: ReviewerRowProps) {
  const detail = status === "away" && awayUntil ? `until ${awayUntil}` : last;
  const canNudge = status !== "done" && status !== "away" && !nudged && !you;
  return (
    <div
      data-slot="reviewer-row"
      data-status={status}
      data-highlight={highlight || undefined}
      className={cn(
        "grid min-h-10 grid-cols-[minmax(0,210px)_140px_64px_minmax(0,1fr)_auto] items-center gap-4 text-body-sm",
        highlight &&
          "-mx-2.5 rounded-lg bg-surf-hl px-2.5 py-1 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_45%,transparent)]",
        className,
      )}
      {...props}
    >
      <Person person={person} you={you} />
      <ProgressBar
        value={of === 0 ? 0 : (done / of) * 100}
        aria-label={`${person.name}, ${done} of ${of} slides`}
        tone={status === "done" ? "ok" : "accent"}
      />
      <span className="font-mono text-fg tabular-nums">
        {done} of {of}
      </span>
      <span className="flex min-w-0 items-center gap-2.5 text-fg-dim">
        <StatusTag tone={statusTones[status]}>{statusWords[status]}</StatusTag>
        <span className="min-w-0 truncate">
          {detail}
          {nudged ? " · nudged just now" : ""}
        </span>
      </span>
      <span className="flex justify-end gap-1.5">
        {canNudge ? (
          <Button size="sm" onClick={onNudge}>
            <Icon name="bell" />
            Nudge
          </Button>
        ) : null}
        {status === "done" ? null : (
          <Button
            size="sm"
            variant={status === "away" ? "primary" : "secondary"}
            onClick={onReassign}
          >
            Reassign
          </Button>
        )}
      </span>
      {hint ? (
        <div className="col-span-full -mt-1 flex items-center gap-2 rounded-lg bg-warn-soft px-2.5 py-2 text-fg">
          <Icon name="info" />
          <span>{hint}</span>
        </div>
      ) : null}
    </div>
  );
}

type TaskBlockProps = Omit<React.ComponentProps<"section">, "title"> & {
  title: string;
  code?: string;
  project: string;
  due: string;
  dueIn: string;
  overdue?: boolean;
  highlight?: boolean;
};

function DueText({ due, dueIn, overdue }: { due: string; dueIn: string; overdue: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-body-sm whitespace-nowrap",
        overdue ? "font-semibold text-bad" : "text-fg-dim",
      )}
    >
      <Icon name={overdue ? "warn" : "calendar"} />
      Due {due} · {dueIn}
    </span>
  );
}

function TaskBlock({
  title,
  code,
  project,
  due,
  dueIn,
  overdue = false,
  highlight = false,
  className,
  children,
  ...props
}: TaskBlockProps) {
  return (
    <section
      data-slot="task-block"
      data-highlight={highlight || undefined}
      className={cn(
        "grid min-w-0 content-start gap-2.5 rounded-zone border border-surf-edge bg-surf-section p-(--pad-zone)",
        highlight && "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-surf-hl",
        className,
      )}
      {...props}
    >
      <div className="flex min-h-5 items-center justify-between gap-2.5">
        <h3 className="m-0 text-body font-semibold text-fg">
          {code ? (
            <>
              <span className="font-mono tabular-nums">{code}</span> ·{" "}
            </>
          ) : null}
          {title}
        </h3>
        <DueText due={due} dueIn={dueIn} overdue={overdue} />
      </div>
      <p className="m-0 text-body-sm leading-[1.45] text-fg-dim">{project}</p>
      {children}
    </section>
  );
}

type DoneTaskRowProps = React.ComponentProps<"div"> & {
  code: string;
  title: string;
  project: string;
  people: PersonInfo[];
  signedOn: string;
  onOpenReport?: () => void;
};

function DoneTaskRow({
  code,
  title,
  project,
  people,
  signedOn,
  onOpenReport,
  className,
  ...props
}: DoneTaskRowProps) {
  return (
    <div
      data-slot="done-task-row"
      className={cn(
        "grid min-h-13 grid-cols-[minmax(0,1fr)_120px_180px_auto] items-center gap-4",
        className,
      )}
      {...props}
    >
      <span className="min-w-0">
        <b className="text-body font-semibold">
          <span className="font-mono tabular-nums">{code}</span> · {title}
        </b>
        <small className="mt-0.5 block text-body-sm text-fg-dim">{project}</small>
      </span>
      <AvatarStack people={people} size={22} max={4} />
      <span className="inline-flex items-center gap-1.5 text-body-sm whitespace-nowrap text-fg-dim">
        <Icon name="check" />
        Signed off {signedOn}
      </span>
      <Button size="sm" onClick={onOpenReport}>
        <Icon name="file" />
        Open the report
      </Button>
    </div>
  );
}

type TeamNoMatchProps = React.ComponentProps<"div"> & { onClear?: () => void };

function TeamNoMatch({ onClear, className, children, ...props }: TeamNoMatchProps) {
  return (
    <div
      data-slot="team-no-match"
      className={cn(
        "flex items-center gap-2.5 rounded-zone bg-surf-section p-4.5 text-body-sm text-fg-dim",
        className,
      )}
      {...props}
    >
      <Icon name="search" />
      <span>{children}</span>
      <Button size="sm" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}

type ConfirmInButtonProps = {
  label: string;
  question: string;
  confirm: string;
  onConfirm?: () => void;
  disabled?: boolean;
  title?: string | undefined;
  asking?: boolean;
  onAskingChange?: (asking: boolean) => void;
};

function ConfirmInButton({
  label,
  question,
  confirm,
  onConfirm,
  disabled = false,
  title,
  asking: askingProp,
  onAskingChange,
}: ConfirmInButtonProps) {
  const [askingState, setAskingState] = useState(false);
  const asking = askingProp ?? askingState;
  const setAsking = (next: boolean) => {
    setAskingState(next);
    onAskingChange?.(next);
  };
  if (!asking || disabled) {
    return (
      <Button onClick={() => setAsking(true)} disabled={disabled} title={title}>
        <Icon name="bell" />
        {label}
      </Button>
    );
  }
  return (
    <span data-slot="confirm-in-button" className="inline-flex items-center gap-2.5">
      <span className="text-body-sm font-semibold text-fg">{question}</span>
      <Button onClick={() => setAsking(false)}>Cancel</Button>
      <Button
        variant="primary"
        onClick={() => {
          onConfirm?.();
          setAsking(false);
        }}
      >
        <Icon name="bell" />
        {confirm}
      </Button>
    </span>
  );
}

type ReadOnlyPersonProps = { person: PersonInfo; done: number; of: number };

function ReadOnlyPerson({ person, done, of }: ReadOnlyPersonProps) {
  return (
    <div className="flex min-h-6 items-center text-body-sm">
      <Person person={person} sub={`${done} of ${of} slides done`} />
    </div>
  );
}

const textareaClass =
  "w-full resize-y rounded-ctl border border-line-strong bg-surf-field px-2.5 py-2 text-body-sm leading-[1.45] text-fg outline-none placeholder:text-fg-faint focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]";

type NudgeModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtitle: React.ReactNode;
  person: PersonInfo;
  done: number;
  of: number;
  message: string;
  onMessageChange: (message: string) => void;
  onSend: () => void;
  maxLength?: number;
};

function NudgeModal({
  open,
  onOpenChange,
  subtitle,
  person,
  done,
  of,
  message,
  onMessageChange,
  onSend,
  maxLength = 500,
}: NudgeModalProps) {
  const empty = message.trim() === "";
  return (
    <SmallModal
      open={open}
      onOpenChange={onOpenChange}
      title="Nudge"
      subtitle={subtitle}
      hint="Sent by email and shown at the top of My work."
      primaryLabel="Send"
      onPrimary={onSend}
      blockers={empty ? [{ id: "message", text: "Write a message to send.", goTo: "Go to" }] : []}
    >
      <FormField label="To">
        <ReadOnlyPerson person={person} done={done} of={of} />
      </FormField>
      <FormField label="Message" count={`${message.length} of ${maxLength}`}>
        <textarea
          aria-label="Message"
          rows={4}
          maxLength={maxLength}
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          className={textareaClass}
        />
      </FormField>
    </SmallModal>
  );
}

type ReassignWhat = "rest" | "all";

type ReassignModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtitle: React.ReactNode;
  from: PersonInfo;
  done: number;
  of: number;
  candidates: TokenItem[];
  to: string | null;
  onToChange: (to: string | null) => void;
  toWarning?: React.ReactNode;
  what: ReassignWhat;
  onWhatChange: (what: ReassignWhat) => void;
  note: string;
  onNoteChange: (note: string) => void;
  onReassign: () => void;
};

function ReassignModal({
  open,
  onOpenChange,
  subtitle,
  from,
  done,
  of,
  candidates,
  to,
  onToChange,
  toWarning,
  what,
  onWhatChange,
  note,
  onNoteChange,
  onReassign,
}: ReassignModalProps) {
  const left = of - done;
  const count = what === "all" ? of : left;
  const first = from.name.split(" ")[0] ?? from.name;
  const options: { value: ReassignWhat; label: string }[] = [
    { value: "rest", label: `The ${left} slides not started` },
    { value: "all", label: `All ${of} slides, including ${done} with decisions` },
  ];
  return (
    <SmallModal
      open={open}
      onOpenChange={onOpenChange}
      width={560}
      title="Reassign slides"
      subtitle={subtitle}
      hint="Both are told by email."
      primaryLabel={`Reassign ${count} slides`}
      onPrimary={onReassign}
      blockers={to ? [] : [{ id: "to", text: "Pick who takes the slides.", goTo: "Go to" }]}
    >
      <FormField label="From">
        <ReadOnlyPerson person={from} done={done} of={of} />
      </FormField>
      <FormField label="To" warning={toWarning}>
        <TokenField
          label="To"
          placeholder="Type a name"
          items={candidates}
          picked={to ? [to] : []}
          single
          onPickedChange={(ids) => onToChange(ids.at(-1) ?? null)}
        />
      </FormField>
      <FormField label="What moves">
        <RadioGroup
          aria-label="What moves"
          value={what}
          onValueChange={(value) => onWhatChange(value as ReassignWhat)}
          className="gap-2.5"
        >
          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-2.5 text-body-sm font-medium text-fg"
            >
              <RadioGroupItem value={option.value} className="mt-0.5" />
              <span>{option.label}</span>
            </label>
          ))}
        </RadioGroup>
        {what === "all" ? (
          <div className="flex items-start gap-1.5 text-body-sm leading-[1.45] text-warn">
            <Icon name="warn" size="xs" className="mt-0.5 shrink-0" />
            <span>
              {done} slides already have {first}'s decisions. They stay under {first}'s name and the
              new reviewer starts fresh on them.
            </span>
          </div>
        ) : null}
      </FormField>
      <FormField label="Note" optional count={`${note.length} of 300`}>
        <textarea
          aria-label="Note"
          rows={2}
          maxLength={300}
          placeholder="For both of them"
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          className={textareaClass}
        />
      </FormField>
    </SmallModal>
  );
}

export {
  ConfirmInButton,
  type ConfirmInButtonProps,
  DoneTaskRow,
  type DoneTaskRowProps,
  NudgeModal,
  type NudgeModalProps,
  ReassignModal,
  type ReassignModalProps,
  type ReassignWhat,
  ReviewerRow,
  type ReviewerRowProps,
  type ReviewerStatus,
  TaskBlock,
  type TaskBlockProps,
  TeamNoMatch,
  type TeamNoMatchProps,
};
