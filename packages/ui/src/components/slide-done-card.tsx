import { InlineError } from "@parfocal/ui/components/banner";
import { BeforeYouList, type Blocker } from "@parfocal/ui/components/before-you-list";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { ProgressRing } from "@parfocal/ui/components/progress-meter";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { FilterChip } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import * as React from "react";

type OpinionQuestion = {
  id: string;
  question: string;
  required?: boolean;
  kind: "scale" | "choice" | "yesno" | "text";
  options?: string[];
  help?: string;
  answer?: string;
  missing?: boolean;
};

type SlideDoneCounts = {
  total: number;
  agree: number;
  disagree: number;
  unsure: number;
  open: number;
  added?: number;
};

function doneLine(counts: SlideDoneCounts) {
  const decided = counts.total - counts.open;
  const head = decided === counts.total ? `${counts.total}` : `${decided} of ${counts.total}`;
  const added = counts.added ? ` ${counts.added} added.` : "";
  return `${head} objects checked: ${counts.agree} agree, ${counts.disagree} disagree, ${counts.unsure} not sure.${added}`;
}

type AnswerChange = ((id: string, value: string) => void) | undefined;

function QuestionControl({
  question,
  onAnswerChange,
}: {
  question: OpinionQuestion;
  onAnswerChange: AnswerChange;
}) {
  const change = (value: unknown) => onAnswerChange?.(question.id, String(value));
  const picked = onAnswerChange
    ? { value: question.answer ?? "" }
    : question.answer
      ? { value: question.answer }
      : {};
  if (question.kind === "scale") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label={question.question}
          size="lg"
          className="w-fit [&>*]:min-w-11"
          {...picked}
          onValueChange={change}
          options={["1", "2", "3", "4", "5"].map((value) => ({ value, label: value }))}
        />
        {question.help ? <span className="text-body-sm text-fg-dim">{question.help}</span> : null}
      </div>
    );
  }
  if (question.kind === "yesno") {
    return (
      <SegmentedControl
        aria-label={question.question}
        size="lg"
        className="w-fit"
        {...picked}
        onValueChange={change}
        options={[
          { value: "Yes", label: "Yes" },
          { value: "No", label: "No" },
        ]}
      />
    );
  }
  if (question.kind === "choice") {
    return (
      <div className="flex flex-wrap gap-2">
        {(question.options ?? []).map((option) => (
          <FilterChip
            key={option}
            pressed={question.answer === option}
            onPressedChange={() => change(option)}
          >
            {option}
          </FilterChip>
        ))}
      </div>
    );
  }
  return (
    <textarea
      aria-label={question.question}
      rows={2}
      placeholder="Optional"
      {...(onAnswerChange
        ? { value: question.answer ?? "", onChange: (event) => change(event.target.value) }
        : { defaultValue: question.answer })}
      className="w-full resize-y rounded-ctl border border-line-strong bg-surf-field px-2.5 py-2 text-body-sm leading-[1.45] text-fg outline-none placeholder:text-fg-faint focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
    />
  );
}

type SlideDoneCardProps = React.ComponentProps<"div"> & {
  slideNumber: number;
  counts: SlideDoneCounts;
  questions: OpinionQuestion[];
  blockers?: Blocker[];
  submitLabel: string;
  failed?: boolean;
  warning?: string | undefined;
  lockedReason?: string;
  panel?: boolean;
  onSubmit?: () => void;
  onAnswerChange?: AnswerChange;
};

function SlideDoneCard({
  slideNumber,
  counts,
  questions,
  blockers = [],
  submitLabel,
  failed = false,
  warning,
  lockedReason,
  panel = false,
  onSubmit,
  onAnswerChange,
  className,
  ...props
}: SlideDoneCardProps) {
  const done = counts.open === 0;
  const off = Boolean(lockedReason) || blockers.length > 0;
  const whyId = React.useId();
  const listId = `${whyId}-list`;
  const reasonId = `${whyId}-reason`;
  const describedBy = failed
    ? undefined
    : lockedReason || blockers.length === 1
      ? reasonId
      : blockers.length
        ? listId
        : undefined;
  const under = failed ? (
    <InlineError>
      The review could not be submitted. Nothing was lost, every decision is saved.
    </InlineError>
  ) : lockedReason ? (
    <span id={reasonId} className="text-center text-body-sm text-fg-dim">
      {lockedReason}
    </span>
  ) : blockers.length === 1 ? (
    <span id={reasonId} className="text-center text-body-sm text-fg-dim">
      {blockers[0]?.text}.
    </span>
  ) : blockers.length ? null : (
    <span className="text-center text-body-sm text-fg-dim">
      Saved as you go. You can change it until the researcher signs off.
    </span>
  );
  return (
    <div
      data-slot="slide-done-card"
      data-panel={panel || undefined}
      className={cn("flex flex-col text-fg", panel ? "gap-5" : "gap-5.5", className)}
      {...props}
    >
      <div className="grid justify-items-start gap-2">
        {done ? (
          <span className="grid size-10 place-items-center rounded-full bg-[color-mix(in_srgb,var(--ok)_16%,transparent)] text-ok">
            <Icon name="check" size="md" />
          </span>
        ) : (
          <ProgressRing
            split={{
              agree: counts.agree,
              disagree: counts.disagree,
              unsure: counts.unsure,
              open: counts.open,
            }}
            size={40}
          />
        )}
        <h2 className={cn("m-0 font-semibold", panel ? "text-title-sm" : "text-page-title")}>
          {done ? `Slide ${slideNumber} is done` : `${counts.open} left on slide ${slideNumber}`}
        </h2>
        <p className="m-0 text-body-sm leading-[1.45] text-fg-dim">{doneLine(counts)}</p>
      </div>
      <div className="grid gap-4">
        {questions.map((question, index) => (
          <div
            key={question.id}
            data-missing={question.missing || undefined}
            className="grid gap-2 rounded-ctl"
          >
            <div className="flex items-baseline justify-between gap-3">
              <b
                className={cn("text-body font-semibold", question.missing ? "text-bad" : "text-fg")}
              >
                {index + 1} · {question.question}
              </b>
              {question.required ? (
                <span className="shrink-0 text-caption text-fg-dim">Required</span>
              ) : null}
            </div>
            <QuestionControl question={question} onAnswerChange={onAnswerChange} />
          </div>
        ))}
      </div>
      <BeforeYouList id={listId} title="Before you submit" blockers={blockers} />
      {warning ? (
        <InlineError tone="warn" role="status" data-slot="submit-warning">
          {warning}
        </InlineError>
      ) : null}
      <div className="mt-auto grid gap-2.5">
        <button
          type="button"
          disabled={off}
          aria-describedby={describedBy}
          onClick={onSubmit}
          className={cn(
            "group/button flex cursor-pointer items-center justify-center gap-2.5 border-0 bg-accent-fill font-semibold text-on-accent outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-[color-mix(in_srgb,var(--accent-fill)_35%,transparent)] disabled:text-fg-dim",
            panel ? "h-10 rounded-ctl text-body" : "h-13.5 rounded-zone text-lead",
          )}
          data-variant="primary"
        >
          {failed ? "Try again" : submitLabel}
          <Keycap keys="↵" />
        </button>
        {under}
      </div>
    </div>
  );
}

export {
  doneLine,
  type OpinionQuestion,
  SlideDoneCard,
  type SlideDoneCardProps,
  type SlideDoneCounts,
};
