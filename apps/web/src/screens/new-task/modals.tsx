import { DecisionButtons } from "@parfocal/ui/components/decision-buttons";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { SmallModal, SmallModalZone } from "@parfocal/ui/components/small-modal";
import { FilterChip, ObjectIdTag } from "@parfocal/ui/components/tag";
import { useState } from "react";
import { type Draft, decisionKinds, mapping, type TaskData } from "./model.ts";
import { CheckRow, RowText, SlideThumb } from "./parts.tsx";
import { SetTags, styleOf } from "./steps.tsx";

type ModalProps = {
  draft: Draft;
  data: TaskData;
  onClose: () => void;
};

export function AddSlidesModal({
  draft,
  data,
  onClose,
  onAdd,
}: ModalProps & { onAdd: (ids: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const pool = data.pool
    .filter((id) => !draft.extraSlides.includes(id))
    .flatMap((id) => {
      const slide = data.slides.find((candidate) => candidate.id === id);
      return slide ? [slide] : [];
    });
  const where = (slide: (typeof pool)[number]) =>
    slide.caseLabel ? `Case ${slide.caseLabel}` : "Loose";
  const shown = pool.filter((slide) =>
    `${slide.name} ${where(slide)}`.toLowerCase().includes(needle),
  );
  const short = data.resultSets.find((set) => set.id === draft.resultSetId)?.short ?? "";
  const count = picked.length;
  return (
    <SmallModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      width={560}
      title="Add slides"
      subtitle={`To ${draft.name.trim() || "the new task"} · from P07`}
      hint={`${count} picked`}
      primaryLabel={count ? `Add ${count} slide${count > 1 ? "s" : ""}` : "Add slides"}
      blockers={count ? [] : [{ id: "pick", text: "Pick at least one slide", goTo: "" }]}
      onPrimary={() => onAdd(picked)}
    >
      <div className="relative">
        <Icon name="search" className="absolute top-2 left-2.5 text-fg-dim" />
        <Input
          aria-label="Find a slide or case"
          placeholder="Find a slide or case"
          className="pl-8"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="grid gap-0.5">
        {shown.map((slide) => {
          const ok = slide.sets.includes(draft.resultSetId);
          return (
            <CheckRow
              key={slide.id}
              label={slide.name}
              checked={picked.includes(slide.id)}
              disabled={!ok}
              onChange={(checked) =>
                setPicked((current) =>
                  checked ? [...current, slide.id] : current.filter((id) => id !== slide.id),
                )
              }
              end={
                ok ? (
                  <SetTags data={data} ids={slide.sets} />
                ) : (
                  <span className="text-body-sm text-fg-dim">no {short}</span>
                )
              }
            >
              <SlideThumb />
              <RowText title={slide.name} sub={where(slide)} />
            </CheckRow>
          );
        })}
        {!pool.length ? (
          <span className="text-body-sm text-fg-dim">
            Every slide of the project is in the task.
          </span>
        ) : !shown.length ? (
          <span className="text-body-sm text-fg-dim">Nothing matches "{query.trim()}".</span>
        ) : null}
      </div>
    </SmallModal>
  );
}

const regionReasons = ["Not tumor", "Boundary is off", "Two regions, not one", "Artefact or fold"];
const unsureReasons = [
  "Need a deeper level",
  "Need IHC",
  "Border unclear",
  "Out of focus",
  "Need a second look",
];

function countsAsFor(draft: Draft, raw: string) {
  if (raw === "unsure") return "unsure";
  const kind = draft.decision.kind;
  if (kind === "certainty5") {
    const value = Number(raw);
    const map = mapping(draft.decision);
    return map.agree.includes(value)
      ? "agree"
      : map.disagree.includes(value)
        ? "disagree"
        : "unsure";
  }
  if (kind === "agree") return raw as "agree" | "disagree";
  if (kind === "yesno") return raw === "yes" ? "agree" : "disagree";
  return raw === "Tumor" ? "agree" : "disagree";
}

const countsWords = { agree: "agree", disagree: "disagree", unsure: "not sure" } as const;
const countsColours = {
  agree: "var(--decision-agree)",
  disagree: "var(--decision-disagree)",
  unsure: "var(--decision-unsure)",
};

const projectClasses = [
  { name: "Tumor", color: "var(--c-tumor)" },
  { name: "Stroma", color: "var(--c-stroma)" },
  { name: "Immune", color: "var(--c-immune)" },
  { name: "Other", color: "var(--c-other)" },
];

export function PreviewQuestionModal({ draft, onClose }: ModalProps) {
  const [raw, setRaw] = useState<string | undefined>(undefined);
  const [reasons, setReasons] = useState<string[]>([]);
  const kind = draft.decision.kind;
  const name = decisionKinds.find((candidate) => candidate.key === kind)?.name ?? "";
  const counts = raw === undefined ? null : countsAsFor(draft, raw);
  const offered = counts === "disagree" ? regionReasons : counts === "unsure" ? unsureReasons : [];
  const question =
    kind === "certainty5"
      ? "How sure are you that T2 is tumor?"
      : kind === "agree"
        ? "The AI says T2 is tumor, 91% sure."
        : kind === "yesno"
          ? "Is this tumor?"
          : "What is T2?";
  return (
    <SmallModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      width={560}
      title="Preview the question"
      subtitle={`T2 on A1 · ${name}`}
      hint="Nothing is saved. Reviewers get this card for every object."
      primaryLabel="Done"
      showCancel={false}
      onPrimary={onClose}
    >
      <SmallModalZone>
        <div className="grid gap-3.5">
          <div className="flex items-center gap-1 text-body-sm text-fg-dim">
            <ObjectIdTag>T2</ObjectIdTag>
            {kind === "certainty5" ? (
              <span>
                AI says: <b className="font-semibold text-fg">Tumor, 91% sure</b>
              </span>
            ) : kind === "agree" ? null : (
              <span>The AI's claim is hidden in this style</span>
            )}
          </div>
          <p className="m-0 text-lead leading-[1.35] font-semibold text-fg">{question}</p>
          <DecisionButtons
            label="Answer in the preview"
            decisionStyle={styleOf[kind]}
            range={{ agreeFrom: draft.decision.agreeFrom, disagreeTo: draft.decision.disagreeTo }}
            classes={projectClasses}
            aiClass="Tumor"
            value={raw}
            onValueChange={(next) => {
              setRaw(next);
              setReasons([]);
            }}
          />
          {counts ? (
            <div className="flex items-center gap-2 text-body-sm text-fg-dim">
              <i
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: countsColours[counts] }}
              />
              <span>
                Counts as <b className="text-fg">{countsWords[counts]}</b>
              </span>
            </div>
          ) : null}
          {offered.length ? (
            <div className="grid gap-2">
              <span className="text-body-sm font-semibold text-fg">
                {counts === "disagree" ? "What is wrong" : "Why not sure"}
              </span>
              <div className="flex flex-wrap gap-2">
                {offered.map((reason) => (
                  <FilterChip
                    key={reason}
                    className="h-8"
                    pressed={reasons.includes(reason)}
                    onPressedChange={(pressed) =>
                      setReasons((current) =>
                        pressed
                          ? [...current, reason]
                          : current.filter((other) => other !== reason),
                      )
                    }
                  >
                    {reason}
                  </FilterChip>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </SmallModalZone>
    </SmallModal>
  );
}
