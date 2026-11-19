import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { FormField } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { AvatarStack, Person, type PersonInfo } from "@parfocal/ui/components/person";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import { RadioGroup, RadioGroupItem } from "@parfocal/ui/components/radio-group";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { StatusTag, type StatusTone } from "@parfocal/ui/components/tag";
import { TokenField, type TokenItem } from "@parfocal/ui/components/token-field";
import { lazyText } from "@parfocal/ui/lib/lazy-text";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";
import { useState } from "react";

type ReviewerStatus = "on-track" | "behind" | "not-started" | "away" | "done";

const statusWords: Record<ReviewerStatus, string> = lazyText(() => ({
  "on-track": t`On track`,
  behind: t`Behind`,
  "not-started": t`Not started`,
  away: t`Away`,
  done: t`Done`,
}));

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
  const { t } = useLingui();

  const detail = status === "away" && awayUntil ? `until ${awayUntil}` : last;
  const canNudge = status !== "done" && status !== "away" && !nudged && !you;
  return (
    <div
      data-slot="reviewer-row"
      data-status={status}
      data-highlight={highlight || undefined}
      className={cn(
        "grid min-h-[calc(24px+2*var(--density-cell-y))] grid-cols-[minmax(0,210px)_140px_64px_minmax(0,1fr)_auto] items-center gap-4 text-body-sm",
        highlight &&
          "-mx-2.5 rounded-lg px-2.5 py-1 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_45%,transparent)]",
        className,
      )}
      {...props}
    >
      <Person person={person} you={you} />
      <ProgressBar
        value={of === 0 ? 0 : (done / of) * 100}
        aria-label={t`${person.name}, ${done} of ${of} slides`}
        tone={status === "done" ? "ok" : "accent"}
      />
      <span className="font-mono text-fg tabular-nums">
        <Trans>
          {done} of {of}
        </Trans>
      </span>
      <span className="flex min-w-0 items-center gap-2.5 text-fg-dim">
        <StatusTag tone={statusTones[status]}>{statusWords[status]}</StatusTag>
        <span className="min-w-0 truncate">
          {detail}
          {nudged ? t` · nudged just now` : ""}
        </span>
      </span>
      <span className="flex justify-end gap-1.5">
        {canNudge ? (
          <Button size="sm" onClick={onNudge}>
            <Icon name="bell" />
            <Trans>Nudge</Trans>
          </Button>
        ) : null}
        {status === "done" ? null : (
          <Button
            size="sm"
            variant={status === "away" ? "primary" : "secondary"}
            onClick={onReassign}
          >
            <Trans>Reassign</Trans>
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
  due?: string | undefined;
  dueIn?: string | undefined;
  overdue?: boolean;
  highlight?: boolean;
  links?: React.ReactNode;
};

function DueText({
  due,
  dueIn,
  overdue,
}: {
  due: string | undefined;
  dueIn: string | undefined;
  overdue: boolean;
}) {
  if (due === undefined) {
    return (
      <span className="inline-flex items-center gap-1.5 text-body-sm whitespace-nowrap text-fg-dim">
        <Icon name="calendar" />
        <Trans>No due date</Trans>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-body-sm whitespace-nowrap",
        overdue ? "font-semibold text-bad" : "text-fg-dim",
      )}
    >
      <Icon name={overdue ? "warn" : "calendar"} />
      <Trans>Due {due}</Trans>
      {dueIn ? ` · ${dueIn}` : null}
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
  links,
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
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="m-0 text-body-sm leading-[1.45] text-fg-dim">{project}</p>
        {links ? <span className="flex flex-wrap items-center gap-1">{links}</span> : null}
      </div>
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
        <Trans>Signed off {signedOn}</Trans>
      </span>
      <Button size="sm" onClick={onOpenReport}>
        <Icon name="file" />
        <Trans>Open the report</Trans>
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
        <Trans>Clear filters</Trans>
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
      <Button onClick={() => setAsking(false)}>
        <Trans>Cancel</Trans>
      </Button>
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
  const { t } = useLingui();

  return (
    <div className="flex min-h-6 items-center text-body-sm">
      <Person person={person} sub={t`${done} of ${of} slides done`} />
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
  const { t } = useLingui();

  const empty = message.trim() === "";
  return (
    <SmallModal
      open={open}
      onOpenChange={onOpenChange}
      title={t`Nudge`}
      subtitle={subtitle}
      hint={t`Sent by email and shown at the top of My work.`}
      primaryLabel={t`Send`}
      onPrimary={onSend}
      blockers={empty ? [{ id: "message", text: t`Write a message to send.`, goTo: t`Go to` }] : []}
    >
      <FormField label={t`To`}>
        <ReadOnlyPerson person={person} done={done} of={of} />
      </FormField>
      <FormField label={t`Message`} count={t`${message.length} of ${maxLength}`}>
        <textarea
          aria-label={t`Message`}
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
  const { t } = useLingui();

  const left = of - done;
  const count = what === "all" ? of : left;
  const first = from.name.split(" ")[0] ?? from.name;
  const options: { value: ReassignWhat; label: string }[] = [
    { value: "rest", label: t`The ${left} slides not started` },
    { value: "all", label: t`All ${of} slides, including ${done} with decisions` },
  ];
  return (
    <SmallModal
      open={open}
      onOpenChange={onOpenChange}
      width={560}
      title={t`Reassign slides`}
      subtitle={subtitle}
      hint={t`Both are told by email.`}
      primaryLabel={t`Reassign ${count} slides`}
      onPrimary={onReassign}
      blockers={to ? [] : [{ id: "to", text: t`Pick who takes the slides.`, goTo: t`Go to` }]}
    >
      <FormField label={t`From`}>
        <ReadOnlyPerson person={from} done={done} of={of} />
      </FormField>
      <FormField label={t`To`} warning={toWarning}>
        <TokenField
          label={t`To`}
          placeholder={t`Type a name`}
          items={candidates}
          picked={to ? [to] : []}
          single
          onPickedChange={(ids) => onToChange(ids.at(-1) ?? null)}
        />
      </FormField>
      <FormField label={t`What moves`}>
        <RadioGroup
          aria-label={t`What moves`}
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
              <Trans>
                {done} slides already have {first}'s decisions. They stay under {first}'s name and
                the new reviewer starts fresh on them.
              </Trans>
            </span>
          </div>
        ) : null}
      </FormField>
      <FormField label={t`Note`} optional count={t`${note.length} of 300`}>
        <textarea
          aria-label={t`Note`}
          rows={2}
          maxLength={300}
          placeholder={t`For both of them`}
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
