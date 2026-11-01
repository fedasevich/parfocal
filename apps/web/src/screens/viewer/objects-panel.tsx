import type { ReviewObject, SlideAiProgress } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { DecisionButtons, type ProjectClass } from "@parfocal/ui/components/decision-buttons";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import type { PersonInfo } from "@parfocal/ui/components/person";
import { Switch } from "@parfocal/ui/components/switch";
import { ObjectIdTag, StatusTag } from "@parfocal/ui/components/tag";
import { AiRunningSteps, type AiStep } from "@parfocal/ui/components/visualize";
import { Zone } from "@parfocal/ui/components/zone";
import type { ReactNode } from "react";
import type { CardText, ReviewStyle } from "../review/decision-style.ts";
import { answerLabel, NoteEditor, noteReasonsFor, SavedNote } from "../review/object-card.tsx";
import type { Answer } from "../review/review-state.ts";

const stepText: Record<
  SlideAiProgress["steps"][number]["key"],
  { icon: AiStep["icon"]; label: string }
> = {
  tissue: { icon: "check", label: "Tissue found" },
  regions: { icon: "flag", label: "Tumor regions" },
  cells: { icon: "eye", label: "Cells, after the regions" },
};

export function aiSteps(progress: SlideAiProgress): AiStep[] {
  return progress.steps.map((step) => {
    const text = stepText[step.key];
    const label =
      step.key === "tissue" && step.fragments
        ? `${text.label}, ${step.fragments} fragments`
        : text.label;
    const value =
      step.state === "queued"
        ? "queued"
        : step.state === "running"
          ? `${step.percent}%`
          : `0:${String(step.seconds ?? 0).padStart(2, "0")}`;
    return { icon: text.icon, label, value, state: step.state, percent: step.percent };
  });
}

export function RunningObjects({
  progress,
  objects,
}: {
  progress: SlideAiProgress;
  objects: ReviewObject[];
}) {
  const found = objects.filter((item) => progress.found.includes(item.object));
  return (
    <>
      <Zone
        title={`Still reading this slide, ${found.length} regions so far`}
        end={<StatusTag tone="accent">reading</StatusTag>}
      >
        <p className="m-0 text-body-sm leading-[1.5] text-fg-dim">
          You can look at the slide meanwhile. Regions join the list as they are found, and the view
          never moves under you.
        </p>
        <AiRunningSteps steps={aiSteps(progress)} />
      </Zone>
      <ul aria-label="Found so far" className="m-0 grid list-none gap-1 p-0">
        {found.map((item) => (
          <li
            key={item.object}
            className="grid grid-cols-[44px_1fr_auto_auto] items-start gap-2 px-1 py-2 text-body-sm"
          >
            <ObjectIdTag>{item.object}</ObjectIdTag>
            <span className="grid">
              <span>Tumor region</span>
              <small className="inline-flex items-center gap-1.5 text-caption text-fg-dim">
                <i aria-hidden="true" className="size-2 rounded-full border border-fg-dim" />
                just found
              </small>
            </span>
            <span className="font-mono text-fg-dim">{item.score.toFixed(2)}</span>
            <span className="font-mono text-fg-dim">{item.size_mm?.toFixed(1)} mm</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function TellMeWhenReady({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="grid">
        <span className="text-body-sm font-semibold">Tell me when it is ready</span>
        <small className="text-caption text-fg-dim">
          A notification when every region is found
        </small>
      </span>
      <Switch checked={on} onCheckedChange={onChange} />
    </label>
  );
}

type NoteState = { open: boolean; reasons: string[]; text: string };

type ObjectFootProps = {
  object: ReviewObject;
  text: CardText;
  style: ReviewStyle;
  classes: ProjectClass[];
  answer: Answer | undefined;
  disabledReason: string | undefined;
  author: PersonInfo | undefined;
  note: NoteState;
  saveOffReason: string | undefined;
  onNote: (note: NoteState) => void;
  onSaveNote: () => void;
  onAnswer: (raw: string) => void;
  onClose: () => void;
};

export function ObjectFoot({
  object,
  text,
  style,
  classes,
  answer,
  disabledReason,
  author,
  note,
  saveOffReason,
  onNote,
  onSaveNote,
  onAnswer,
  onClose,
}: ObjectFootProps) {
  const sub =
    object.kind === "cell"
      ? "Cell in your sample"
      : `Tumor region · ${object.size_mm?.toFixed(object.size_mm < 1 ? 2 : 1)} mm`;
  let noteBlock: ReactNode = null;
  if (note.open) {
    noteBlock = (
      <NoteEditor
        object={object.object}
        reasons={noteReasonsFor(object.kind, answer?.value)}
        chosen={note.reasons}
        text={note.text}
        offReason={saveOffReason}
        onReason={(reason) =>
          onNote({
            ...note,
            reasons: note.reasons.includes(reason)
              ? note.reasons.filter((item) => item !== reason)
              : [...note.reasons, reason],
          })
        }
        onText={(value) => onNote({ ...note, text: value })}
        onSave={onSaveNote}
        onCancel={() => onNote({ ...note, open: false })}
      />
    );
  } else if (answer && (answer.note || answer.reasons.length)) {
    noteBlock = (
      <SavedNote
        answer={answer}
        label={answerLabel(style, answer, classes)}
        author={author}
        onEdit={() => onNote({ open: true, reasons: answer.reasons, text: answer.note ?? "" })}
      />
    );
  } else if (answer) {
    noteBlock = (
      <button
        type="button"
        onClick={() => onNote({ open: true, reasons: answer.reasons, text: "" })}
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-body-sm font-medium text-fg-dim hover:text-fg"
      >
        <Icon name="comment" />
        Add a note
        <Keycap keys="N" size="sm" />
      </button>
    );
  }
  return (
    <div className="grid gap-2.5" data-slot="object-foot">
      <div className="flex items-center gap-2">
        <ObjectIdTag>{object.object}</ObjectIdTag>
        <span className="flex-1 text-body-sm text-fg-dim">{sub}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          title="Close (Esc)"
          onClick={onClose}
        >
          <Icon name="close" />
        </Button>
      </div>
      {text.hiddenNote ? (
        <small className="inline-flex items-center gap-2 text-caption font-semibold text-fg-dim">
          <Icon name="eye" />
          {text.hiddenNote}
        </small>
      ) : null}
      {text.above ? (
        <small className="text-caption text-fg-dim">AI says: {text.above}</small>
      ) : null}
      <b className="text-body font-semibold">{text.question}</b>
      <DecisionButtons
        decisionStyle={style.kind}
        size="large"
        className="[&_button]:h-9.5 [&_button]:text-body"
        value={answer?.raw}
        onValueChange={onAnswer}
        classes={classes}
        aiClass={object.class_name}
        disabled={disabledReason !== undefined}
        title={disabledReason}
        label={`Your answer on ${object.object}`}
      />
      {noteBlock}
    </div>
  );
}

export function AddedFoot({
  object,
  size,
  note,
  onClose,
}: {
  object: string;
  size: string;
  note: string | null;
  onClose: () => void;
}) {
  return (
    <div className="grid gap-2.5" data-slot="object-foot">
      <div className="flex items-center gap-2">
        <ObjectIdTag>{object}</ObjectIdTag>
        <span className="flex-1 text-body-sm text-fg-dim">Tumor region · {size}</span>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </Button>
      </div>
      <p className="m-0 text-body-sm leading-[1.5] text-fg-dim">
        Added by you:{" "}
        {note ? `${note.charAt(0).toLowerCase()}${note.slice(1)}` : "missed by the AI"}. It sits
        outside the scope and is counted apart.
      </p>
    </div>
  );
}

export function MeasurementFoot({
  object,
  mm,
  across,
  onClose,
  onRemove,
}: {
  object: string;
  mm: number;
  across: string;
  onClose: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid gap-2.5" data-slot="object-foot">
      <div className="flex items-center gap-2">
        <ObjectIdTag>{object}</ObjectIdTag>
        <span className="flex-1 text-body-sm text-fg-dim">Measurement · {mm.toFixed(2)} mm</span>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </Button>
      </div>
      <p className="m-0 text-body-sm leading-[1.5] text-fg-dim">
        Drawn with the ruler across {across}. It is yours only and is not a decision.
      </p>
      <Button className="w-full" onClick={onRemove}>
        Remove {object}
      </Button>
    </div>
  );
}
