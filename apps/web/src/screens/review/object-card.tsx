import type { ReviewObject } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { MentionText } from "@parfocal/ui/components/comment-thread";
import { DecisionButtons, type ProjectClass } from "@parfocal/ui/components/decision-buttons";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { Person, type PersonInfo } from "@parfocal/ui/components/person";
import { FilterChip, ObjectIdTag } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import type { ReactNode } from "react";
import { ConfidenceByColour } from "./confidence-chip.tsx";
import {
  type CardText,
  type Count,
  countWord,
  type ReviewStyle,
  rawLabel,
  unsureReasons,
} from "./decision-style.ts";
import { disagreeOptions } from "./disagree-reasons.ts";
import { dotGlyphOf, dotStateWord } from "./guided-progress.ts";
import type { Answer } from "./review-state.ts";

const dotTone: Record<Count, string> = {
  agree: "bg-v-agree text-black",
  disagree: "bg-v-disagree text-black",
  unsure: "bg-v-unsure text-black",
};

type DotsProps = {
  regions: ReviewObject[];
  cells: ReviewObject[];
  current: string;
  answer: (object: string) => Answer | undefined;
  skipped: string[];
  onJump: (object: string) => void;
};

export function ObjectDots({ regions, cells, current, answer, skipped, onJump }: DotsProps) {
  const cellsDone = cells.filter((cell) => answer(cell.object)).length;
  const onCell = cells.some((cell) => cell.object === current);
  return (
    <fieldset
      aria-label="Objects"
      className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
    >
      {regions.map((region) => {
        const value = answer(region.object)?.value;
        const skip = skipped.includes(region.object) && !value;
        const glyph = dotGlyphOf(value);
        return (
          <button
            key={region.object}
            type="button"
            onClick={() => onJump(region.object)}
            title={`${region.object}, ${dotStateWord(value, skip)}`}
            aria-label={region.object}
            aria-current={region.object === current ? "true" : undefined}
            className={cn(
              "grid size-5.5 cursor-pointer place-items-center rounded-full border-0 p-0 text-label font-bold",
              value ? dotTone[value] : "bg-transparent shadow-[inset_0_0_0_1.5px_var(--fg-dim)]",
              skip && "shadow-[inset_0_0_0_1.5px_var(--warn)]",
              region.object === current &&
                "shadow-[0_0_0_2px_var(--chrome),0_0_0_4px_color-mix(in_srgb,var(--accent)_75%,white)]",
            )}
          >
            {glyph === "check" ? (
              <Icon name="check" size="xs" />
            ) : glyph === "cross" ? (
              <Icon name="close" size="xs" />
            ) : glyph === "question" ? (
              "?"
            ) : null}
          </button>
        );
      })}
      {cells.length ? (
        <button
          type="button"
          onClick={() => onJump("cells")}
          title={`Cells in the sample, ${cellsDone} of ${cells.length} decided. Opens the first open cell`}
          className={cn(
            "inline-flex h-5.5 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-chrome-2 px-2.5 text-caption text-fg-dim",
            onCell && "shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--accent)_75%,white)]",
          )}
        >
          Cells
          <b className="font-mono font-semibold text-fg">
            {cellsDone} of {cells.length}
          </b>
        </button>
      ) : null}
    </fieldset>
  );
}

type NoteEditorProps = {
  object: string;
  reasons: string[];
  chosen: string[];
  text: string;
  offReason: string | undefined;
  onReason: (reason: string) => void;
  onText: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function NoteEditor({
  object,
  reasons,
  chosen,
  text,
  offReason,
  onReason,
  onText,
  onSave,
  onCancel,
}: NoteEditorProps) {
  return (
    <div className="grid gap-2.5 rounded-zone border border-line bg-surf-section p-2.5">
      {reasons.length ? (
        <fieldset
          aria-label="Quick reasons, optional"
          className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0"
        >
          {reasons.map((reason) => (
            <FilterChip
              key={reason}
              pressed={chosen.includes(reason)}
              onPressedChange={() => onReason(reason)}
            >
              {reason}
            </FilterChip>
          ))}
        </fieldset>
      ) : null}
      <textarea
        rows={2}
        value={text}
        onChange={(event) => onText(event.target.value)}
        placeholder="Add a note, type @ to mention someone"
        aria-label={`Note on your decision for ${object}`}
        className="min-h-13.5 w-full resize-y rounded-ctl border border-accent bg-surf-field px-2.5 py-2 text-body-sm leading-[1.45] text-fg outline-none placeholder:text-fg-faint focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]"
      />
      <div className="flex items-center gap-2">
        <span className="flex-1 text-caption text-fg-dim">Optional</span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel <Keycap action="esc" keys="Esc" size="sm" />
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={Boolean(offReason)}
          title={offReason}
          onClick={onSave}
        >
          Save <Keycap keys="↵" size="sm" />
        </Button>
      </div>
    </div>
  );
}

type SavedNoteProps = {
  answer: Answer;
  label: string;
  author: PersonInfo | undefined;
  onEdit: () => void;
};

export function SavedNote({ answer, label, author, onEdit }: SavedNoteProps) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        {author ? <Person person={author} size={20} /> : null}
        <span className="flex-1 text-right text-body-sm text-fg-dim">
          Note on decision: {label}
        </span>
        <Button variant="ghost" size="xs" onClick={onEdit}>
          Edit
        </Button>
      </div>
      {answer.reasons.length ? (
        <span className="text-caption text-fg-dim">{answer.reasons.join(", ")}</span>
      ) : null}
      {answer.note ? (
        <q className="border-l-2 border-line-strong pl-2.5 text-body-sm leading-[1.45] text-fg">
          <MentionText text={answer.note} />
        </q>
      ) : null}
    </div>
  );
}

export type LockLine = { icon: IconName; text: string; tone: "warn" | "lock" } | null;

type ObjectCardProps = {
  position: number;
  total: number;
  object: ReviewObject;
  dots: ReactNode;
  text: CardText;
  style: ReviewStyle;
  classes: ProjectClass[];
  answer: Answer | undefined;
  pending: Count | null;
  lockLine: LockLine;
  disabled: boolean;
  disagreeOpen: boolean;
  note: ReactNode;
  coach?: ReactNode;
  onAnswer: (raw: string) => void;
  onReason: (reason: string) => void;
  onBackToAnswers: () => void;
  onFix: (what: string) => void;
  redrawPoints: number | null;
  onFinishRedraw: () => void;
  onCancelRedraw: () => void;
  onAddMissed: () => void;
};

export function ObjectCard({
  position,
  total,
  object,
  dots,
  text,
  style,
  classes,
  answer,
  pending,
  lockLine,
  disabled,
  disagreeOpen,
  note,
  coach,
  onAnswer,
  onReason,
  onBackToAnswers,
  onFix,
  redrawPoints,
  onFinishRedraw,
  onCancelRedraw,
  onAddMissed,
}: ObjectCardProps) {
  const head = (
    <div className="flex items-center justify-between gap-3">
      <span className="text-body text-fg-dim">
        Object <b className="font-semibold text-fg">{position}</b> of {total} on this slide
      </span>
      <ObjectIdTag size="lg">{object.object}</ObjectIdTag>
    </div>
  );
  if (redrawPoints !== null) {
    return (
      <div className="grid gap-5" data-testid="redraw-panel">
        {head}
        {dots}
        <div className="grid gap-1.5">
          <h2 className="m-0 text-title font-semibold leading-snug text-fg">
            Draw the new outline of {object.object}
          </h2>
          <p className="m-0 text-body text-fg-dim">
            Click around it. Click the first point or press Finish to close it. The AI result stays
            as it was.
          </p>
          <small className="text-body-sm text-fg-dim" aria-live="polite">
            {redrawPoints} {redrawPoints === 1 ? "point" : "points"}
          </small>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={redrawPoints < 3} onClick={onFinishRedraw}>
            <Icon name="check" />
            Finish outline
          </Button>
          <Button onClick={onCancelRedraw}>Cancel</Button>
        </div>
      </div>
    );
  }
  if (disagreeOpen) {
    return (
      <div className="grid gap-5">
        {head}
        {dots}
        <small className="text-body-sm font-semibold text-fg-dim">
          You disagree with the AI on {object.object}
        </small>
        <div className="grid gap-2.5">
          <span className="text-body-sm font-semibold">What is wrong</span>
          <div className="flex flex-wrap gap-2">
            {disagreeOptions(object.kind, object.class_name, classes).map(({ label: reason }) => (
              <FilterChip
                key={reason}
                pressed={answer?.reasons.includes(reason) ?? false}
                onPressedChange={() => onReason(reason)}
                className="h-8 px-3 text-body-sm"
              >
                {reason}
              </FilterChip>
            ))}
          </div>
          {note}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-full text-body-sm text-fg-dim">
            Want to fix it yourself? Optional.
          </span>
          <Button onClick={() => onFix("outline")}>
            <Icon name="pen" />
            Redraw the outline
          </Button>
          <Button onClick={() => onFix("type")}>
            <Icon name="pen" />
            Change the type
          </Button>
        </div>
        <Button variant="ghost" className="w-fit px-0" onClick={onBackToAnswers}>
          <Icon name="back" />
          Back to the answers
        </Button>
      </div>
    );
  }
  const shown = pending ?? answer?.value;
  const selected = pending ? (pending === "unsure" ? "unsure" : undefined) : answer?.raw;
  return (
    <div className="grid gap-5">
      {head}
      {dots}
      <div className="grid gap-1.5">
        {text.hiddenNote ? (
          <small className="inline-flex items-center gap-2 text-body-sm font-semibold text-fg-dim">
            <Icon name="eye-off" />
            {text.hiddenNote}
          </small>
        ) : null}
        {text.above ? (
          <>
            <small className="text-body-sm font-semibold text-fg-dim">AI says</small>
            <p className="m-0 text-lead text-fg">{text.above}</p>
          </>
        ) : null}
        <ConfidenceByColour chip={text.chip} />
        <h2 className="m-0 text-title font-semibold leading-snug text-fg">{text.question}</h2>
        {text.context ? <p className="m-0 text-body text-fg-dim">{text.context}</p> : null}
      </div>
      <DecisionButtons
        decisionStyle={style.kind}
        value={selected}
        onValueChange={onAnswer}
        classes={classes}
        aiClass={object.class_name}
        range={{ agreeFrom: style.agreeFrom, disagreeTo: style.disagreeTo }}
        disabled={disabled}
        label={`Your answer on ${object.object}`}
      />
      {pending ? (
        <span className="inline-flex items-center gap-2 text-body-sm text-warn">
          <Icon name="clock" />
          Not saved yet. It saves when the connection is back.
        </span>
      ) : lockLine ? (
        <span className="inline-flex items-center gap-2 text-body-sm text-warn">
          <Icon name={lockLine.icon} />
          {lockLine.text}
        </span>
      ) : null}
      {shown ? note : null}
      {coach}
      <Button className="w-fit" disabled={disabled} onClick={onAddMissed}>
        <Icon name="poly" />
        Add something the AI missed
      </Button>
    </div>
  );
}

export function noteReasonsFor(
  object: ReviewObject,
  value: Count | undefined,
  classes: ProjectClass[],
) {
  if (value === "disagree") {
    return disagreeOptions(object.kind, object.class_name, classes).map((option) => option.label);
  }
  if (value === "unsure") return unsureReasons;
  return [];
}

export function answerLabel(style: ReviewStyle, answer: Answer, classes: ProjectClass[]) {
  return style.kind === "agree" ? countWord[answer.value] : rawLabel(style, answer.raw, classes);
}
