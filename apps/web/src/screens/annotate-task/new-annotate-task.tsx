import { useGetProject } from "@parfocal/api-client";
import {
  annotatePresets,
  BlindFirstSwitch,
  CheckOptions,
  type CheckOptionValues,
  type PresetKey,
  PresetPicker,
} from "@parfocal/ui/components/annotate-task";
import { Button } from "@parfocal/ui/components/button";
import { FlowBar, FlowPage, type FlowStep, SummaryRows } from "@parfocal/ui/components/flow-page";
import { PersonAvatar } from "@parfocal/ui/components/person";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Zone } from "@parfocal/ui/components/zone";
import { useState } from "react";
import { SidebarToggle } from "../../shell/sidebar-toggle.tsx";
import { okData } from "../placeholder.tsx";
import { resultName } from "./fake-task.ts";
import { type AnnotateStep, annotateStepKeys } from "./step-keys.ts";
import { useTaskPeople } from "./task-people.ts";

const stepNames: Record<AnnotateStep, string> = {
  kind: "Kind",
  slides: "Slides",
  experts: "Experts",
  check: "What to check",
  how: "How it runs",
  send: "Send",
};

const slideRows = [
  { id: "A1", name: "A1 H&E", result: true },
  { id: "A2", name: "A2 H&E", result: true },
  { id: "B4", name: "B4 CK", result: false },
  { id: "C2", name: "C2 H&E", result: false },
];

const scopeNames = {
  none: "Nothing to check",
  all: "All AI objects",
  sample: "A random sample",
  regions: "Objects inside regions",
} as const;

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
  };

export function NewAnnotateTask({ projectId, step, preset, onStep }: NewAnnotateTaskProps) {
  const project = okData(useGetProject(projectId).data);
  const people = useTaskPeople();
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
        { label: project?.name ?? "Project" },
        { label: "Tasks" },
        { label: "New annotate task" },
      ]}
      title="New annotate task"
      subtitle="Experts draw on a shared layer for each slide and check what the AI made."
      steps={steps}
      current={index}
      reached={reached}
      onStepSelect={(chosenIndex) => {
        const key = annotateStepKeys[chosenIndex];
        if (key) onStep(key);
      }}
      bar={
        <FlowBar
          hint={`About ${toCheck} objects to check, roughly ${minutes} min per expert`}
          back={before ? <Button onClick={() => onStep(before)}>Back</Button> : undefined}
          primary={{
            label: after ? "Next" : "Send to experts",
            onClick: () => (after ? onStep(after) : undefined),
          }}
        />
      }
    >
      {step === "kind" ? (
        <>
          <Zone title="Kind" sub="Annotate tasks have no decisions, the experts make the data.">
            <SegmentedControl
              aria-label="Kind of task"
              value="annotate"
              options={[
                { value: "review", label: "Review AI results" },
                { value: "annotate", label: "Annotate" },
              ]}
            />
          </Zone>
          <Zone title="Preset" sub="Pick the setup that is closest to your study.">
            <PresetPicker value={chosen} onValueChange={choosePreset} />
          </Zone>
        </>
      ) : null}
      {step === "slides" ? (
        <Zone
          title="Slides"
          sub="Slides with no result set can be annotated by hand. Slides with one start with the AI objects."
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
                      <StatusTag>No result set</StatusTag>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </Zone>
      ) : null}
      {step === "experts" ? (
        <Zone title="Experts" sub="Every expert edits the same layer on each slide.">
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
          title="What to check"
          sub={
            hasResult
              ? "The preset filled these in. Change any of them."
              : "The preset Annotate by hand has no result set, so there is nothing to check."
          }
        >
          <CheckOptions values={options} onValuesChange={setOptions} />
        </Zone>
      ) : null}
      {step === "how" ? (
        <Zone title="How it runs">
          <BlindFirstSwitch checked={blind} onCheckedChange={setBlind} />
        </Zone>
      ) : null}
      {step === "send" ? (
        <Zone title="Send" sub="One last look before the experts get the task.">
          <SummaryRows
            rows={[
              {
                label: "Preset",
                value: annotatePresets.find((item) => item.key === chosen)?.title ?? "",
                onChange: () => onStep("kind"),
              },
              {
                label: "Slides",
                value: `${picked.length} slides, ${slidesWithResult} with a result set`,
                onChange: () => onStep("slides"),
              },
              { label: "Experts", value: "3 experts", onChange: () => onStep("experts") },
              {
                label: "Check scope",
                value: `${scopeNames[options.scope]}${options.scope === "none" ? "" : options.order === "least-sure" ? ", least sure first" : ", by position"}`,
                onChange: () => onStep("check"),
              },
              {
                label: "Sign-off rule",
                value: options.rule === "require" ? "All must be checked" : "Only warn",
                onChange: () => onStep("check"),
              },
              {
                label: "Unchecked AI objects",
                value: options.exportUnchecked
                  ? "Included in the export"
                  : "Left out of the export",
                onChange: () => onStep("check"),
              },
              {
                label: "Blind first",
                value: blind ? "On" : "Off",
                onChange: () => onStep("how"),
              },
            ]}
          />
        </Zone>
      ) : null}
    </FlowPage>
  );
}
