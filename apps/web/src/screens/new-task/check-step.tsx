import { Trans, useLingui } from "@lingui/react/macro";
import { CheckOptions, checkSummary } from "@parfocal/ui/components/annotate-task";
import { Button } from "@parfocal/ui/components/button";
import { CountsAsLine } from "@parfocal/ui/components/counts-as";
import { Icon } from "@parfocal/ui/components/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Zone } from "@parfocal/ui/components/zone";
import {
  type DecisionKindKey,
  decisionKinds,
  estimateText,
  isAnnotate,
  questionKinds,
  roiRow,
  scopeRows,
  type TemplateChoice,
  templateChanges,
} from "./model.ts";
import { FieldNote, fieldId, GroupTitle, RadioRows, ToggleRow } from "./parts.tsx";
import { ScopeRow } from "./reviewers-step.tsx";
import { type StepProps, styleOf } from "./steps.tsx";

function AnnotateCheckStep({ draft, data, update }: StepProps) {
  const { t } = useLingui();

  return (
    <Zone
      title={t`What to check`}
      sub={
        draft.check.hasResult
          ? t`${checkSummary(draft.check)} The preset filled these in, change any of them.`
          : t`The preset Annotate by hand has no result set, so there is nothing to check.`
      }
    >
      <CheckOptions
        values={draft.check}
        onValuesChange={(check) => update((current) => ({ ...current, check }))}
      />
      <p className="m-0 mt-1 text-body-sm leading-[1.45] text-fg-dim">
        {estimateText(draft, data)}
      </p>
    </Zone>
  );
}

export function CheckStep(props: StepProps) {
  return isAnnotate(props.draft) ? (
    <AnnotateCheckStep {...props} />
  ) : (
    <ReviewCheckStep {...props} />
  );
}

function FromTemplate({
  template,
  changed,
}: {
  template: TemplateChoice | undefined;
  changed: boolean;
}) {
  const { t } = useLingui();

  if (!template) return null;
  return (
    <span className="text-body-sm text-fg-dim" data-from-template={changed ? "changed" : "kept"}>
      {changed
        ? t`Changed from ${template.name}. The report still uses the template.`
        : t`Filled in by ${template.name}`}
    </span>
  );
}

function ReviewCheckStep({ draft, data, update, errors, openModal }: StepProps) {
  const { t } = useLingui();

  const template = data.templates.find((candidate) => candidate.id === draft.templateId);
  const form = data.forms.find((candidate) => candidate.key === draft.form);
  const shared = { draft, data, update, errors };
  return (
    <>
      <Zone
        title={t`Objects to check`}
        end={<FromTemplate template={template} changed={templateChanges(draft, data).check} />}
      >
        <div className="grid gap-2" id={fieldId("scope")}>
          <GroupTitle>
            <Trans>What to check</Trans>
          </GroupTitle>
          {scopeRows.map((row) => (
            <ScopeRow key={row.key} row={row} {...shared} />
          ))}
          <FieldNote error={errors.get("scope")} />
        </div>
        <div className="mt-3 grid gap-2">
          <GroupTitle>
            <Trans>Only inside</Trans>
          </GroupTitle>
          <ScopeRow row={roiRow} {...shared} />
        </div>
        <p className="m-0 mt-1 text-body-sm leading-[1.45] text-fg-dim">
          {estimateText(draft, data)}
        </p>
      </Zone>
      <Zone
        title={t`Decision question`}
        end={<FromTemplate template={template} changed={templateChanges(draft, data).how} />}
        sub={t`What reviewers answer for each object. Every answer keeps its raw value, so counts can be worked out again later.`}
      >
        <div className="grid gap-1.5">
          <RadioRows
            label={t`Decision question`}
            value={draft.decision.kind}
            onChange={(value) =>
              update((current) => ({
                ...current,
                decision: { kind: value as DecisionKindKey, agreeFrom: 4, disagreeTo: 2 },
              }))
            }
            options={decisionKinds.map((kind) => ({
              value: kind.key,
              title: kind.name,
              sub: kind.detail,
              under: (
                <CountsAsLine
                  id={fieldId("decision")}
                  data-counts-as-line=""
                  className="mt-0.5 mb-1.5 ml-6.25"
                  decisionStyle={styleOf[kind.key]}
                  agreeFrom={draft.decision.agreeFrom}
                  disagreeTo={draft.decision.disagreeTo}
                  onRangeChange={(range) =>
                    update((current) => ({
                      ...current,
                      decision: { ...current.decision, ...range },
                      touched: { ...current.touched, decision: true },
                    }))
                  }
                />
              ),
            }))}
          />
          <FieldNote error={errors.get("decision")} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => openModal("dpreview")}>
            <Icon name="eye" />
            <Trans>Preview</Trans>
          </Button>
        </div>
      </Zone>
      <Zone
        title={t`Opinion form`}
        sub={t`Asked once per slide, after the objects.`}
        end={<FromTemplate template={template} changed={templateChanges(draft, data).form} />}
      >
        <Select
          value={draft.form}
          onValueChange={(value) =>
            update((current) => ({
              ...current,
              form: String(value),
              required:
                String(value) === "none"
                  ? []
                  : (data.forms
                      .find((candidate) => candidate.key === value)
                      ?.questions.flatMap((question, index) =>
                        question.required ? [`q${index + 1}`] : [],
                      ) ?? []),
            }))
          }
        >
          <SelectTrigger aria-label={t`Opinion form`} className="h-9.5 w-102">
            <SelectValue>{form ? form.name : "None"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {[...data.forms, { key: "none", name: "None", questions: [] }].map((choice) => (
              <SelectItem key={choice.key} value={choice.key}>
                <span className="grid">
                  <span>{choice.name}</span>
                  <small className="text-caption text-fg-dim">
                    {choice.questions.length
                      ? `${choice.questions.length} questions`
                      : "No questions after the objects"}
                  </small>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {form ? (
          <div className="grid">
            {form.questions.map((question, index) => {
              const key = `q${index + 1}`;
              const on = draft.required.includes(key);
              return (
                <div
                  key={key}
                  className="grid min-h-10 grid-cols-[20px_minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-line text-body-sm"
                >
                  <span className="text-fg-dim">{index + 1}</span>
                  <span className="text-fg">{question.label}</span>
                  <StatusTag>{questionKinds[question.kind] ?? question.kind}</StatusTag>
                  <ToggleRow
                    inline
                    title={t`Required`}
                    checked={on}
                    onChange={() =>
                      update((current) => ({
                        ...current,
                        required: current.required.includes(key)
                          ? current.required.filter((other) => other !== key)
                          : [...current.required, key],
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="m-0 text-body-sm text-fg-dim">
            <Trans>
              Reviewers submit each slide without a form, and the report leaves the opinion block
              out.
            </Trans>
          </p>
        )}
      </Zone>
    </>
  );
}
