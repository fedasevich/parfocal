import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { annotatePresets, ChoiceCards, PresetPicker } from "@parfocal/ui/components/annotate-task";
import { Button } from "@parfocal/ui/components/button";
import type { DecisionStyle } from "@parfocal/ui/components/decision-buttons";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Zone } from "@parfocal/ui/components/zone";
import { type ReactNode, useState } from "react";
import { LazySavedTemplatePdf } from "../evaluation/pdf-overlay-lazy.tsx";
import {
  annotateSlideLine,
  type DecisionKindKey,
  type Draft,
  isAnnotate,
  isRetired,
  pickedSlides,
  type StepKey,
  slideLine,
  slidesWithResult,
  summary,
  type TaskData,
  type TemplateChoice,
} from "./model.ts";
import { CheckRow, FieldNote, fieldId, RadioRows, RowText, SlideThumb, Warn } from "./parts.tsx";

export type StepProps = {
  draft: Draft;
  data: TaskData;
  update: (change: (draft: Draft) => Draft) => void;
  errors: ReadonlyMap<string, string>;
  onTemplate: (template: TemplateChoice) => void;
  openModal: (modal: "addslides" | "dpreview") => void;
  goTo: (step: StepKey) => void;
};

export const styleOf: Record<DecisionKindKey, DecisionStyle> = {
  certainty5: "certainty",
  agree: "agree",
  yesno: "yesno",
  blind: "blind",
};

export const setColours = { cam: "var(--c-tumor)", sam: "#a3e635", rev: "#38bdf8" } as const;

export const rsShort = (data: TaskData, id: string) =>
  data.resultSets.find((set) => set.id === id)?.short ?? t`this result set`;

export function TextLink({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer border-0 bg-transparent p-0 text-body-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent"
    >
      {children}
    </button>
  );
}

export function KindStep({ draft, update }: StepProps) {
  const { t } = useLingui();

  return (
    <>
      <Zone title={t`Kind`}>
        <ChoiceCards
          legend={t`What the experts do`}
          value={draft.kind}
          onValueChange={(kind) =>
            update((current) => ({ ...current, kind: kind as Draft["kind"] }))
          }
          choices={[
            {
              value: "review",
              title: t`Review AI results`,
              text: t`Reviewers decide whether the AI result is right, without drawing.`,
            },
            {
              value: "annotate",
              title: t`Annotate`,
              text: t`Experts draw cells and fix what the AI found. The output is training data.`,
            },
          ]}
        />
      </Zone>
      {isAnnotate(draft) ? (
        <Zone
          title={t`Starting point`}
          sub={t`A suggestion only. It fills in the next steps, and you can change every setting there.`}
        >
          <PresetPicker
            value={draft.preset}
            onValueChange={(preset) => {
              const options = annotatePresets.find((item) => item.key === preset)?.options;
              update((current) => ({
                ...current,
                preset,
                check: options ? { ...options } : current.check,
              }));
            }}
          />
        </Zone>
      ) : null}
    </>
  );
}

export function SlidesStep({ draft, data, update, errors, onTemplate, openModal }: StepProps) {
  const { t } = useLingui();

  const [previewing, setPreviewing] = useState(false);
  const sum = summary(draft, data);
  const all = pickedSlides(draft, data);
  const short = rsShort(data, draft.resultSetId);
  const byId = new Map(data.slides.map((slide) => [slide.id, slide]));
  const template = data.templates.find((candidate) => candidate.id === draft.templateId);
  const annotate = isAnnotate(draft);
  const withResult = slidesWithResult(draft, data).length;
  const leftOut = data.groups
    .filter((group) => draft.groups[group.key])
    .map((group) => ({
      group,
      count: group.slideIds.filter((id) => !byId.get(id)?.sets.includes(draft.resultSetId)).length,
    }))
    .filter((item) => item.count > 0);
  return (
    <>
      {annotate ? null : (
        <Zone title={t`Study template`}>
          <div className="grid gap-1.5">
            <div className="flex items-center gap-4">
              <Select
                value={draft.templateId}
                onValueChange={(value) => {
                  const next = data.templates.find((candidate) => candidate.id === value);
                  if (next) onTemplate(next);
                }}
              >
                <SelectTrigger
                  id={fieldId("tpl")}
                  aria-label={t`Study template`}
                  aria-invalid={errors.get("tpl") ? true : undefined}
                  className="h-9.5 w-102 font-semibold"
                >
                  <SelectValue>
                    {template
                      ? `${template.name} ${template.version}${isRetired(draft, template) ? " · retired" : ""}`
                      : "Pick a template"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {data.templates.map((choice) => (
                    <SelectItem
                      key={choice.id}
                      value={choice.id}
                      disabled={isRetired(draft, choice)}
                    >
                      <span className="grid">
                        <span>
                          {choice.name} {choice.version}
                          {isRetired(draft, choice) ? " · retired" : ""}
                        </span>
                        <small className="text-caption text-fg-dim">
                          {isRetired(draft, choice) ? "Retired" : choice.kind}
                        </small>
                      </span>
                      {choice.id === data.defaultTemplateId ? (
                        <StatusTag>Project default</StatusTag>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <TextLink onClick={() => setPreviewing(true)}>
                <Trans>Preview the report</Trans>
              </TextLink>
              {previewing && template ? (
                <LazySavedTemplatePdf
                  templateId={template.id}
                  onClose={() => setPreviewing(false)}
                />
              ) : null}
            </div>
            <FieldNote
              error={errors.get("tpl")}
              help={t`It fills in what to check, how it runs and the display defaults. You can still change each of them.`}
            />
          </div>
        </Zone>
      )}
      <Zone
        title={t`Slides`}
        sub={annotate ? annotateSlideLine(sum, withResult, short) : slideLine(sum, short)}
      >
        <div id={fieldId("groups")} tabIndex={-1} className="grid gap-0.5 outline-none">
          {data.groups.map((group) => (
            <CheckRow
              key={group.key}
              className="min-h-11"
              label={group.title}
              checked={Boolean(draft.groups[group.key])}
              onChange={(checked) =>
                update((current) => ({
                  ...current,
                  groups: { ...current.groups, [group.key]: checked },
                  touched: { ...current.touched, groups: true, rset: true },
                }))
              }
              end={`${group.slideIds.length} slides`}
            >
              <SlideThumb />
              <RowText title={group.title} sub={group.sub} />
            </CheckRow>
          ))}
          {draft.extraSlides.map((id) => {
            const slide = byId.get(id);
            if (!slide) return null;
            return (
              <div
                key={id}
                className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 pl-7"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <SlideThumb />
                  <RowText
                    title={slide.name}
                    sub={t`${slide.caseLabel ? `Case ${slide.caseLabel}` : t`Loose`} · added`}
                  />
                </span>
                <SetTags data={data} ids={slide.sets} />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t`Remove ${slide.name}`}
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      extraSlides: current.extraSlides.filter((other) => other !== id),
                      touched: { ...current.touched, groups: true },
                    }))
                  }
                >
                  <Icon name="close" />
                </Button>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => openModal("addslides")}>
            <Icon name="slides" />
            <Trans>Add slides</Trans>
          </Button>
        </div>
        <FieldNote error={errors.get("groups")} />
      </Zone>
      {annotate && !draft.check.hasResult ? null : (
        <Zone title={annotate ? t`AI result to start from` : t`AI result to check`}>
          <div className="grid gap-1.5">
            <RadioRows
              id={fieldId("rset")}
              label={t`AI result to check`}
              value={draft.resultSetId}
              onChange={(value) =>
                update((current) => ({
                  ...current,
                  resultSetId: value,
                  name: current.nameSet ? current.name : (data.names[value] ?? current.name),
                  touched: { ...current.touched, rset: true },
                }))
              }
              options={data.resultSets.map((set) => ({
                value: set.id,
                title: set.label,
                sub: set.detail,
                end: t`on ${all.filter((slide) => slide.sets.includes(set.id)).length} of ${sum.all}`,
              }))}
            />
            <FieldNote error={errors.get("rset")} />
            {!annotate && !sum.ns && all.length ? (
              <Warn icon="smart">
                <Trans>
                  <a href="#run-model" className="text-accent">
                    Run a model
                  </a>{" "}
                  on the picked slides, or pick another result set.
                </Trans>
              </Warn>
            ) : null}
            {sum.ns && !annotate
              ? leftOut.map(({ group, count }) => (
                  <Warn key={group.key}>
                    {count > 1 ? (
                      <Trans>
                        {count} slides in {group.title} have no {short} and are left out.{" "}
                        <a href="#run-model" className="text-accent">
                          Run a model
                        </a>{" "}
                        to include them.
                      </Trans>
                    ) : (
                      <Trans>
                        {count} slide in {group.title} has no {short} and is left out.{" "}
                        <a href="#run-model" className="text-accent">
                          Run a model
                        </a>{" "}
                        to include it.
                      </Trans>
                    )}
                  </Warn>
                ))
              : null}
          </div>
        </Zone>
      )}
      <Zone title={t`Task name`}>
        <div className="grid gap-1.5">
          <Input
            id={fieldId("name")}
            aria-label={t`Task name`}
            aria-invalid={errors.get("name") ? true : undefined}
            value={draft.name}
            maxLength={80}
            placeholder={t`For example, Round 3 · CAMELYON v1.0`}
            onChange={(event) => {
              const name = event.target.value;
              update((current) => ({ ...current, name, nameSet: true }));
            }}
            onBlur={() =>
              update((current) => ({ ...current, touched: { ...current.touched, name: true } }))
            }
          />
          <FieldNote
            error={errors.get("name")}
            help={t`Reviewers see this name in My work and in the email.`}
            count={t`${draft.name.length} of 80`}
          />
        </div>
      </Zone>
    </>
  );
}

export function SetTags({ data, ids }: { data: TaskData; ids: string[] }) {
  if (!ids.length)
    return (
      <span className="text-body-sm text-fg-dim">
        <Trans>no result sets</Trans>
      </span>
    );
  return (
    <span className="flex gap-1.5">
      {ids.map((id) => {
        const set = data.resultSets.find((candidate) => candidate.id === id);
        return set ? (
          <span
            key={id}
            title={set.label}
            className="inline-flex items-center gap-1 text-caption whitespace-nowrap text-fg-dim"
          >
            <Icon name="layers" size="xs" />
            {set.short}
          </span>
        ) : null;
      })}
    </span>
  );
}
