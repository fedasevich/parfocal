import { Trans, useLingui } from "@lingui/react/macro";
import { useGetProject } from "@parfocal/api-client";
import {
  annotatePresets,
  BlindFirstSwitch,
  CheckOptions,
  type CheckOptionValues,
  ChoiceCards,
  checkSummary,
  type PresetKey,
  PresetPicker,
} from "@parfocal/ui/components/annotate-task";
import { Button } from "@parfocal/ui/components/button";
import { FlowBar, FlowPage, type FlowStep, SummaryRows } from "@parfocal/ui/components/flow-page";
import { PersonAvatar } from "@parfocal/ui/components/person";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Zone } from "@parfocal/ui/components/zone";
import { defaultSampleSize } from "@parfocal/ui/lib/sample-size";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { SidebarToggle } from "../../shell/sidebar-toggle.tsx";
import { okData } from "../placeholder.tsx";
import { resultName } from "./fake-task.ts";
import { type AnnotateStep, annotateStepKeys } from "./step-keys.ts";
import { useTaskPeople } from "./task-people.ts";

const slideRows = [
  { id: "A1", name: "A1 H&E", result: true },
  { id: "A2", name: "A2 H&E", result: true },
  { id: "B4", name: "B4 CK", result: false },
  { id: "C2", name: "C2 H&E", result: false },
];

type NewAnnotateTaskProps = {
  projectId: string;
  step: AnnotateStep;
  preset: PresetKey;
  onStep: (step: AnnotateStep) => void;
};

const presetOptions = (key: PresetKey): CheckOptionValues =>
  (annotatePresets.find((item) => item.key === key) ?? annotatePresets[0])?.options ?? {
    scope: "none",
    order: "position",
    rule: "warn",
    exportUnchecked: false,
    hasResult: false,
    sampleSize: defaultSampleSize,
  };

export function NewAnnotateTask({ projectId, step, preset, onStep }: NewAnnotateTaskProps) {
  const { t } = useLingui();
  const stepNames: Record<AnnotateStep, string> = {
    kind: t`Kind`,
    slides: t`Slides`,
    experts: t`Experts`,
    check: t`What to check`,
    how: t`How it runs`,
    send: t`Send`,
  };
  const scopeNames = {
    none: t`Nothing, experts only draw`,
    all: t`Every AI cell`,
    sample: t`A random sample of AI cells`,
    regions: t`AI cells inside the areas you draw`,
  } as const;
  const project = okData(useGetProject(projectId).data);
  const people = useTaskPeople();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<PresetKey>(preset);
  const [options, setOptions] = useState(() => presetOptions(preset));
  const [blind, setBlind] = useState(false);
  const [picked, setPicked] = useState<string[]>(["A1", "A2", "B4"]);
  const index = annotateStepKeys.indexOf(step);
  const reached = annotateStepKeys.length - 1;
  const hasResult = options.hasResult;
  const slidesWithResult = picked.filter(
    (id) => slideRows.find((row) => row.id === id)?.result,
  ).length;
  const toCheck =
    options.scope === "none" ? 0 : options.scope === "sample" ? 50 : 46 * slidesWithResult;
  const minutes = Math.round(toCheck * 0.5 + picked.length * 6);

  const steps: FlowStep[] = annotateStepKeys.map((key) => ({ label: stepNames[key] }));
  const before = annotateStepKeys[index - 1];
  const after = annotateStepKeys[index + 1];

  const choosePreset = (key: PresetKey) => {
    setChosen(key);
    setOptions(presetOptions(key));
  };

  return (
    <FlowPage
      data-testid="new-annotate-task"
      data-step={step}
      className="h-full"
      crumbStart={<SidebarToggle />}
      crumbs={[
        { label: project?.name ?? t`Project` },
        { label: t`Tasks` },
        { label: t`New annotate task` },
      ]}
      title={t`New annotate task`}
      subtitle={t`Experts draw on a shared layer for each slide and check what the AI made.`}
      steps={steps}
      current={index}
      reached={reached}
      onStepSelect={(chosenIndex) => {
        const key = annotateStepKeys[chosenIndex];
        if (key) onStep(key);
      }}
      bar={
        <FlowBar
          hint={t`About ${toCheck} objects to check, roughly ${minutes} min per expert`}
          back={
            before ? (
              <Button onClick={() => onStep(before)}>
                <Trans>Back</Trans>
              </Button>
            ) : undefined
          }
          primary={{
            label: after ? t`Next` : t`Send to experts`,
            onClick: () => (after ? onStep(after) : undefined),
          }}
        />
      }
    >
      {step === "kind" ? (
        <>
          <Zone title={t`Kind`}>
            <ChoiceCards
              legend={t`What the experts do`}
              value="annotate"
              onValueChange={(next) => {
                if (next === "review") {
                  void navigate({ to: "/projects/$projectId/tasks/new", params: { projectId } });
                }
              }}
              choices={[
                {
                  value: "review",
                  title: t`Review AI results`,
                  text: t`Experts decide whether the AI result is right, without drawing.`,
                },
                {
                  value: "annotate",
                  title: t`Annotate`,
                  text: t`Experts draw cells and fix what the AI found. The output is training data.`,
                },
              ]}
            />
          </Zone>
          <Zone
            title={t`Starting point`}
            sub={t`A suggestion only. It fills in the next steps, and you can change every setting there.`}
          >
            <PresetPicker value={chosen} onValueChange={choosePreset} />
          </Zone>
        </>
      ) : null}
      {step === "slides" ? (
        <Zone
          title={t`Slides`}
          sub={t`Slides with no result set can be annotated by hand. Slides with one start with the AI objects.`}
        >
          <ul className="m-0 grid list-none gap-2 p-0">
            {slideRows.map((row) => {
              const on = picked.includes(row.id);
              return (
                <li key={row.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-zone border border-line bg-surf-panel px-3.5 py-2.5 text-body-sm">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setPicked(on ? picked.filter((id) => id !== row.id) : [...picked, row.id])
                      }
                    />
                    <span className="min-w-0 flex-1 font-medium text-fg">{row.name}</span>
                    {row.result ? (
                      <StatusTag tone="accent">{resultName}</StatusTag>
                    ) : (
                      <StatusTag>
                        <Trans>No result set</Trans>
                      </StatusTag>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </Zone>
      ) : null}
      {step === "experts" ? (
        <Zone title={t`Experts`} sub={t`Every expert edits the same layer on each slide.`}>
          <ul className="m-0 grid list-none gap-2 p-0">
            {[people?.me, people?.anna, people?.simona]
              .flatMap((person) => (person ? [person] : []))
              .map((person) => (
                <li
                  key={person.name}
                  className="flex items-center gap-3 rounded-zone border border-line bg-surf-panel px-3.5 py-2.5 text-body-sm"
                >
                  <PersonAvatar person={person} size={24} />
                  <span className="font-medium text-fg">{person.name}</span>
                </li>
              ))}
          </ul>
        </Zone>
      ) : null}
      {step === "check" ? (
        <Zone
          title={t`What to check`}
          sub={
            hasResult
              ? t`${checkSummary(options)} The preset filled these in, change any of them.`
              : t`The preset Annotate by hand has no result set, so there is nothing to check.`
          }
        >
          <CheckOptions values={options} onValuesChange={setOptions} />
        </Zone>
      ) : null}
      {step === "how" ? (
        <Zone title={t`How it runs`}>
          <BlindFirstSwitch checked={blind} onCheckedChange={setBlind} />
        </Zone>
      ) : null}
      {step === "send" ? (
        <Zone title={t`Send`} sub={t`One last look before the experts get the task.`}>
          <SummaryRows
            rows={[
              {
                label: t`Preset`,
                value: annotatePresets.find((item) => item.key === chosen)?.title ?? "",
                onChange: () => onStep("kind"),
              },
              {
                label: t`Slides`,
                value: t`${picked.length} slides, ${slidesWithResult} with a result set`,
                onChange: () => onStep("slides"),
              },
              { label: t`Experts`, value: t`3 experts`, onChange: () => onStep("experts") },
              {
                label: t`Experts check`,
                value: scopeNames[options.scope],
                onChange: () => onStep("check"),
              },
              {
                label: t`Unchecked AI cells`,
                value: options.exportUnchecked
                  ? t`Exported marked as not checked`
                  : t`Left out of the export`,
                onChange: () => onStep("check"),
              },
              ...(options.scope === "none"
                ? []
                : [
                    {
                      label: t`Start with`,
                      value:
                        options.order === "least-sure"
                          ? t`The cells the AI was least sure of`
                          : t`Top left to bottom right`,
                      onChange: () => onStep("check"),
                    },
                    {
                      label: t`Finishing a slide`,
                      value:
                        options.rule === "require"
                          ? t`Only when every cell in scope is checked`
                          : t`Allowed with cells left unchecked`,
                      onChange: () => onStep("check"),
                    },
                  ]),
              {
                label: t`Blind first`,
                value: blind ? t`On` : t`Off`,
                onChange: () => onStep("how"),
              },
            ]}
          />
        </Zone>
      ) : null}
    </FlowPage>
  );
}
