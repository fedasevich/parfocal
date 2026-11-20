import { Trans, useLingui } from "@lingui/react/macro";
import {
  type ReviewTaskDetail,
  useCreateReviewTask,
  useGetProject,
  useListMySlides,
  useListProjectResultSets,
  useListTenantMembers,
} from "@parfocal/api-client";
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
import { DatePicker } from "@parfocal/ui/components/date-picker";
import { FlowBar, FlowPage, type FlowStep, SummaryRows } from "@parfocal/ui/components/flow-page";
import { FormField } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { PersonAvatar } from "@parfocal/ui/components/person";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Zone } from "@parfocal/ui/components/zone";
import { defaultSampleSize } from "@parfocal/ui/lib/sample-size";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { now } from "../../clock.ts";
import { SidebarToggle } from "../../shell/sidebar-toggle.tsx";
import { slideLink } from "../../shell/slide-link.ts";
import { plural } from "../format.ts";
import { checkChangeOf, checkPresetOf } from "../new-task/annotate-draft.ts";
import { toPersonInfo } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { type AnnotateStep, annotateStepKeys } from "./step-keys.ts";

type NewAnnotateTaskProps = {
  projectId: string;
  step: AnnotateStep;
  preset: PresetKey;
  slides?: string[] | undefined;
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

const lengthOf = (minutes: number) =>
  minutes < 90 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;

const todayText = () => {
  const day = now();
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
};

export function NewAnnotateTask({ projectId, step, preset, slides, onStep }: NewAnnotateTaskProps) {
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
  const slideRows = (okData(useListMySlides({ project_id: projectId }).data)?.slides ?? []).map(
    (slide) => ({
      id: slide.id,
      name: slide.label,
      results: slide.result_sets.map((ref) => ({
        id: ref.id,
        name: ref.name.split(" ")[0] ?? ref.name,
      })),
    }),
  );
  const resultSets = okData(useListProjectResultSets(projectId).data) ?? [];
  const members = okData(useListTenantMembers().data) ?? [];
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useCreateReviewTask();
  const [name, setName] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [created, setCreated] = useState<ReviewTaskDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<PresetKey>(preset);
  const [options, setOptions] = useState(() => presetOptions(preset));
  const [blind, setBlind] = useState(false);
  const [picked, setSlideChoice] = useState<string[]>(slides ?? []);
  const [experts, setExpertChoice] = useState<string[]>([]);
  const index = annotateStepKeys.indexOf(step);
  const reached = annotateStepKeys.length - 1;
  const hasResult = options.hasResult;
  const withResult = picked.filter(
    (id) => (slideRows.find((row) => row.id === id)?.results.length ?? 0) > 0,
  );
  const slidesWithResult = withResult.length;
  const cellsInScope = resultSets
    .filter((set) => withResult.includes(set.slide_id))
    .reduce((total, set) => total + set.cell_count, 0);
  const toCheck =
    options.scope === "none"
      ? 0
      : options.scope === "sample"
        ? Math.min(defaultSampleSize, cellsInScope)
        : cellsInScope;
  const minutes = Math.round(toCheck * 0.5 + picked.length * 6);

  const blockers = [
    ...(name.trim() === ""
      ? [
          {
            id: "name",
            text: t`Name the task`,
            goTo: t`Go to`,
            onGoTo: () => onStep("send"),
            target: "#annotate-task-name",
          },
        ]
      : []),
    ...(picked.length === 0
      ? [
          {
            id: "slides",
            text: t`Pick at least one slide`,
            goTo: t`Go to`,
            onGoTo: () => onStep("slides"),
          },
        ]
      : []),
    ...(experts.length === 0
      ? [
          {
            id: "experts",
            text: t`Pick at least one expert`,
            goTo: t`Go to`,
            onGoTo: () => onStep("experts"),
          },
        ]
      : []),
  ];

  const send = () => {
    if (blockers.length > 0 || create.isPending) return;
    setFailed(false);
    const base = presetOptions(chosen);
    const change = checkChangeOf(options, base);
    create.mutate(
      {
        projectId,
        data: {
          name: name.trim(),
          kind: "annotate",
          slide_ids: picked,
          result_sets: options.hasResult
            ? withResult.flatMap((id) => {
                const resultSetId = slideRows.find((row) => row.id === id)?.results[0]?.id;
                return resultSetId ? [{ slide_id: id, result_set_id: resultSetId }] : [];
              })
            : [],
          reviewer_ids: experts,
          split: "everyone",
          scope: { kind: "whole-slide" },
          blinded: false,
          ai_hidden_first_read: false,
          start_mode: "viewer",
          blind_first: blind,
          due_on: dueOn === "" ? null : dueOn,
          preset: checkPresetOf[chosen],
          ...(change ? { check: change } : {}),
        },
      },
      {
        onSuccess: (response) => {
          if (response.status !== 201) {
            setFailed(true);
            return;
          }
          void queryClient.invalidateQueries({
            predicate: (query) => String(query.queryKey[0]).startsWith("/api/me/"),
          });
          setCreated(response.data);
        },
        onError: () => setFailed(true),
      },
    );
  };

  const openCreated = (task: ReviewTaskDetail) => {
    const first = task.slides[0]?.slide_id;
    if (first === undefined) {
      void navigate({
        to: "/projects/$projectId",
        params: { projectId },
        search: { tab: "tasks" },
      });
      return;
    }
    void navigate(slideLink({ projectId, slideId: first, taskId: task.id, mode: "annotate" }));
  };

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
          hint={t`About ${toCheck} objects to check, roughly ${lengthOf(minutes)} per expert`}
          back={
            before && !created ? (
              <Button onClick={() => onStep(before)}>
                <Trans>Back</Trans>
              </Button>
            ) : undefined
          }
          primary={
            created
              ? { label: t`Open the task`, onClick: () => openCreated(created) }
              : after
                ? { label: t`Next`, onClick: () => onStep(after) }
                : {
                    label: t`Send to experts`,
                    onClick: send,
                    disabled: create.isPending,
                    blockers,
                  }
          }
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
          {slideRows.length === 0 ? (
            <p className="m-0 text-body-sm text-fg-dim">
              <Trans>This project has no slides yet. Upload some first.</Trans>
            </p>
          ) : null}
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
                        setSlideChoice(
                          on ? picked.filter((id) => id !== row.id) : [...picked, row.id],
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 font-medium text-fg">{row.name}</span>
                    {row.results.length > 0 ? (
                      <span className="flex flex-wrap gap-1.5">
                        {row.results.map((result) => (
                          <StatusTag key={result.id} tone="accent">
                            {result.name}
                          </StatusTag>
                        ))}
                      </span>
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
          {members.length === 0 ? (
            <p className="m-0 text-body-sm text-fg-dim">
              <Trans>No one in this lab can be asked yet.</Trans>
            </p>
          ) : null}
          <ul className="m-0 grid list-none gap-2 p-0">
            {members.map((member) => {
              const on = experts.includes(member.user_id);
              return (
                <li key={member.user_id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-zone border border-line bg-surf-panel px-3.5 py-2.5 text-body-sm">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setExpertChoice(
                          on
                            ? experts.filter((id) => id !== member.user_id)
                            : [...experts, member.user_id],
                        )
                      }
                    />
                    <PersonAvatar person={toPersonInfo(member)} size={24} />
                    <span className="font-medium text-fg">{member.display_name}</span>
                  </label>
                </li>
              );
            })}
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
      {step === "send" && created ? (
        <Zone title={t`Sent`}>
          <p className="m-0 flex items-center gap-2 text-body-sm text-fg" role="status">
            <Icon name="check" className="text-ok" />
            <span>
              <Trans>
                {created.name} was sent to {plural(created.reviewer_count, "expert")}.
              </Trans>
            </span>
          </p>
        </Zone>
      ) : null}
      {step === "send" && !created ? (
        <Zone title={t`Name and due date`}>
          <div className="grid gap-4">
            <FormField
              id="annotate-task-name-field"
              labelId="annotate-task-name-label"
              label={t`Task name`}
              required
            >
              <Input
                id="annotate-task-name"
                aria-labelledby="annotate-task-name-label"
                value={name}
                maxLength={80}
                placeholder={t`For example, Round 3 · CAMELYON v1.0`}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <FormField
              id="annotate-task-due-field"
              labelId="annotate-task-due-label"
              label={t`Due date`}
              optional
            >
              <DatePicker
                aria-labelledby="annotate-task-due-label"
                value={dueOn}
                today={todayText()}
                min={todayText()}
                onValueChange={setDueOn}
              />
            </FormField>
          </div>
        </Zone>
      ) : null}
      {step === "send" && !created ? (
        <Zone title={t`Send`} sub={t`One last look before the experts get the task.`}>
          {failed ? (
            <p className="m-0 text-body-sm text-bad" role="alert">
              <Trans>The task could not be created. Try again.</Trans>
            </p>
          ) : null}
          <SummaryRows
            rows={[
              {
                label: t`Preset`,
                value: annotatePresets.find((item) => item.key === chosen)?.title ?? "",
                onChange: () => onStep("kind"),
              },
              {
                label: t`Slides`,
                value: t`${plural(picked.length, "slide")}, ${slidesWithResult} with a result set`,
                onChange: () => onStep("slides"),
              },
              {
                label: t`Experts`,
                value: plural(experts.length, t`expert`),
                onChange: () => onStep("experts"),
              },
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
