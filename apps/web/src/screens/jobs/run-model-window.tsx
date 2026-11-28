import { Trans, useLingui } from "@lingui/react/macro";
import {
  getListModelRunsQueryKey,
  getListMyJobsQueryKey,
  type ProjectModel,
  type ProjectSlide,
  useEstimateModelRun,
  useGetModelRunDefaults,
  useGetProject,
  useListProjectModels,
  useListProjectResultSets,
  useListProjectSlides,
  useStartModelRuns,
} from "@parfocal/api-client";
import { Icon } from "@parfocal/ui/components/icon";
import { OutcomeRow } from "@parfocal/ui/components/model-picker";
import { SmallModal, SmallModalZone } from "@parfocal/ui/components/small-modal";
import { TokenField } from "@parfocal/ui/components/token-field";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { now } from "../../clock.ts";
import { formatDayMonth } from "../format.ts";
import { okData } from "../placeholder.tsx";
import { runEstimate } from "./model.ts";
import { slideItems, startingModel, startingSlides } from "./run-model-parts.ts";
import {
  cellModels,
  outputBlockers,
  type PlannedRun,
  plannedRuns,
  startingFor,
  startingPicks,
  tumorModels,
} from "./run-outputs.ts";
import { RunOutputsZone } from "./run-outputs-zone.tsx";

export type RunModelScene = "pick" | "menu" | "lab";

type RunModelWindowProps = {
  projectId: string;
  scene: RunModelScene;
  slideIds?: string[] | undefined;
  onClose: () => void;
  onStarted: () => void;
};

export function RunModelWindow({
  projectId,
  scene,
  slideIds,
  onClose,
  onStarted,
}: RunModelWindowProps) {
  const { t } = useLingui();

  const project = okData(useGetProject(projectId).data);
  const slides = okData(useListProjectSlides(projectId).data);
  const models = okData(useListProjectModels(projectId).data);
  const defaults = okData(useGetModelRunDefaults(projectId).data);
  const sets = okData(useListProjectResultSets(projectId).data) ?? [];
  if (!project || !slides || !models || !defaults) return null;
  const labModel = models.find((model) => model.host === "lab");
  return (
    <RunModelForm
      key={scene}
      projectLabel={t`In ${project.code} · ${project.name}`}
      projectId={projectId}
      slides={slides}
      models={models}
      setNames={new Map(sets.map((set) => [set.id, set.name]))}
      initialSlides={startingSlides(slideIds, defaults.slide_ids, slides)}
      initialModel={startingModel(
        models,
        scene === "lab" && labModel ? labModel.id : defaults.model_id,
      )}
      menuOpen={scene === "menu"}
      onClose={onClose}
      onStarted={onStarted}
    />
  );
}

type RunModelFormProps = {
  projectLabel: string;
  projectId: string;
  slides: ProjectSlide[];
  models: ProjectModel[];
  setNames: Map<string, string>;
  initialSlides: string[];
  initialModel: string | null;
  menuOpen: boolean;
  onClose: () => void;
  onStarted: () => void;
};

function useRunEstimate(
  projectId: string,
  model: ProjectModel | undefined,
  slides: ProjectSlide[],
  picked: string[],
  wanted: boolean,
) {
  const projected = model?.seconds_per_mm2 != null ? model : undefined;
  const estimates = okData(
    useEstimateModelRun(
      projectId,
      projected?.name ?? "",
      { slide_id: picked },
      { query: { enabled: wanted && projected !== undefined && picked.length > 0 } },
    ).data,
  );
  return model
    ? runEstimate(
        model,
        picked.map((id) => slides.find((slide) => slide.id === id) ?? {}),
        now(),
        estimates,
      )
    : null;
}

type PlannedRowProps = {
  run: PlannedRun;
  estimate: ReturnType<typeof runEstimate> | null;
  pickedCount: number;
};

function PlannedRow({ run, estimate, pickedCount }: PlannedRowProps) {
  const { t } = useLingui();
  if (!estimate) return null;
  const what = run.what;
  const title = !pickedCount
    ? t`No slides picked yet`
    : estimate.total === null
      ? t`${what}: time and cost are not known yet`
      : estimate.cost === null
        ? t`${what}: about ${estimate.total} min, done around ${estimate.doneAround}`
        : t`${what}: about ${estimate.total} min and ${estimate.cost}, done around ${estimate.doneAround}`;
  return <OutcomeRow icon="calendar" title={title} detail={estimate.perSlide} />;
}

function RunModelForm({
  projectLabel,
  projectId,
  slides,
  models,
  setNames,
  initialSlides,
  initialModel,
  menuOpen,
  onClose,
  onStarted,
}: RunModelFormProps) {
  const { t } = useLingui();
  const initial = models.find((item) => item.id === initialModel);
  const [picked, setPicked] = useState(initialSlides);
  const [picks, setPicks] = useState(() => startingPicks(initial));
  const [tumorId, setTumorId] = useState(() => startingFor(tumorModels(models), initial));
  const [cellId, setCellId] = useState(() => startingFor(cellModels(models), initial));
  const queryClient = useQueryClient();
  const start = useStartModelRuns();
  const tumor = tumorModels(models).find((item) => item.id === tumorId);
  const cells = cellModels(models).find((item) => item.id === cellId);
  const primary = picks.outlines ? cells : picks.tumor ? tumor : undefined;
  const items = slideItems(slides, setNames, primary);
  const again = picked.some((id) => items.find((item) => item.id === id)?.end);
  const blockers = outputBlockers(picked.length, picks, tumor, cells);
  const planned = plannedRuns(picked, picks, tumor, cells);
  const tumorEstimate = useRunEstimate(projectId, tumor, slides, picked, picks.tumor);
  const cellEstimate = useRunEstimate(projectId, cells, slides, picked, picks.outlines);
  const estimateOf = (run: PlannedRun) => (run.model === tumor ? tumorEstimate : cellEstimate);
  const run = async () => {
    if (blockers.length > 0 || planned.length === 0) return;
    for (const item of planned) {
      await start.mutateAsync({ projectId, data: item.draft });
    }
    await queryClient.invalidateQueries({ queryKey: getListMyJobsQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getListModelRunsQueryKey(projectId) });
    onStarted();
  };
  const names = planned.map((item) => item.model.title).join(" and ");
  return (
    <SmallModal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      width={560}
      title={t`Run a model`}
      subtitle={projectLabel}
      hint={t`You can close this window. Jobs in the top bar shows how far it is.`}
      blockers={blockers}
      primaryBusy={start.isPending}
      primaryLabel={
        <>
          <Icon name="smart" />
          {picked.length
            ? t`Run on ${picked.length} slide${picked.length === 1 ? "" : "s"}`
            : t`Run`}
        </>
      }
      onPrimary={() => void run()}
    >
      <SmallModalZone title={t`Slides`}>
        <div className="grid gap-1.5">
          <TokenField
            label={t`Slides`}
            items={items}
            picked={picked}
            onPickedChange={setPicked}
            placeholder={t`Add slides by name or case`}
            invalid={picked.length === 0}
          />
          <small className="flex justify-between gap-3 text-caption text-fg-dim">
            <span>
              <Trans>The slides without results are picked for you.</Trans>
            </span>
            {again ? (
              <span className="text-warn">
                <Trans>Runs again and adds a second set</Trans>
              </span>
            ) : null}
          </small>
        </div>
      </SmallModalZone>
      <SmallModalZone title={t`What to make`}>
        <RunOutputsZone
          models={models}
          picks={picks}
          onPicks={setPicks}
          tumorId={tumorId}
          onTumorId={setTumorId}
          cellId={cellId}
          onCellId={setCellId}
          menuOpen={menuOpen}
        />
      </SmallModalZone>
      <SmallModalZone title={t`What happens`}>
        <div className="grid gap-3">
          {planned.length ? (
            <OutcomeRow
              icon="layers"
              title={
                planned.length === 1
                  ? t`A new result set on each slide`
                  : t`Two jobs and two new result sets on each slide`
              }
              detail={t`Called ${names} · ${formatDayMonth(now())}. Result sets you already have stay as they are.`}
            />
          ) : null}
          {planned.map((item) => (
            <PlannedRow
              key={item.what}
              run={item}
              estimate={estimateOf(item)}
              pickedCount={picked.length}
            />
          ))}
          <OutcomeRow
            icon="bell"
            title={t`You get a notification when it is done`}
            detail={t`In the bell at the top, with a link to the slides.`}
          />
        </div>
      </SmallModalZone>
    </SmallModal>
  );
}
