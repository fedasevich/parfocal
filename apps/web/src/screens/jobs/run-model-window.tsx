import {
  getListModelRunsQueryKey,
  getListMyJobsQueryKey,
  type ProjectModel,
  type ProjectSlide,
  useGetModelRunDefaults,
  useGetProject,
  useListProjectModels,
  useListProjectResultSets,
  useListProjectSlides,
  useStartModelRuns,
} from "@parfocal/api-client";
import { Icon } from "@parfocal/ui/components/icon";
import { ModelPicker, OutcomeRow } from "@parfocal/ui/components/model-picker";
import { SmallModal, SmallModalZone } from "@parfocal/ui/components/small-modal";
import { TokenField } from "@parfocal/ui/components/token-field";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { now } from "../../clock.ts";
import { formatDayMonth } from "../format.ts";
import { okData } from "../placeholder.tsx";
import { lookUrl } from "../thumbnails.ts";
import { runEstimate } from "./model.ts";
import { modelGroups, runBlockers, slideItems, startingSlides } from "./run-model-parts.ts";

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
  const project = okData(useGetProject(projectId).data);
  const slides = useListProjectSlides(projectId).data?.data;
  const models = okData(useListProjectModels(projectId).data);
  const defaults = useGetModelRunDefaults(projectId).data?.data;
  const sets = okData(useListProjectResultSets(projectId).data) ?? [];
  if (!project || !slides || !models || !defaults) return null;
  const labModel = models.find((model) => model.host === "lab");
  return (
    <RunModelForm
      key={scene}
      projectLabel={`In ${project.code} · ${project.name}`}
      projectId={projectId}
      slides={slides}
      models={models}
      setNames={new Map(sets.map((set) => [set.id, set.name]))}
      initialSlides={startingSlides(slideIds, defaults.slide_ids, slides)}
      initialModel={scene === "lab" && labModel ? labModel.id : defaults.model_id}
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
  initialModel: string;
  menuOpen: boolean;
  onClose: () => void;
  onStarted: () => void;
};

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
  const [picked, setPicked] = useState(initialSlides);
  const [modelId, setModelId] = useState<string | null>(initialModel);
  const [open, setOpen] = useState(menuOpen);
  const queryClient = useQueryClient();
  const start = useStartModelRuns();
  const model = models.find((item) => item.id === modelId);
  const items = slideItems(slides, setNames, model, lookUrl("overview"));
  const again = picked.some((id) => items.find((item) => item.id === id)?.end);
  const blockers = runBlockers(picked.length, model);
  const estimate = model ? runEstimate(model, picked.length, now()) : null;
  const run = async () => {
    if (!model || model.serving === "offline" || picked.length === 0) return;
    await start.mutateAsync({
      projectId,
      data: {
        slide_ids: picked,
        scope: { kind: "slide" },
        parameters: { detector: { name: model.name, version: model.version } },
      },
    });
    await queryClient.invalidateQueries({ queryKey: getListMyJobsQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getListModelRunsQueryKey(projectId) });
    onStarted();
  };
  return (
    <SmallModal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      width={560}
      title="Run a model"
      subtitle={projectLabel}
      hint="You can close this window. Jobs in the top bar shows how far it is."
      blockers={blockers}
      primaryBusy={start.isPending}
      primaryLabel={
        <>
          <Icon name="smart" />
          {picked.length ? `Run on ${picked.length} slide${picked.length === 1 ? "" : "s"}` : "Run"}
        </>
      }
      onPrimary={() => void run()}
    >
      <SmallModalZone title="Slides">
        <div className="grid gap-1.5">
          <TokenField
            label="Slides"
            items={items}
            picked={picked}
            onPickedChange={setPicked}
            placeholder="Add slides by name or case"
            invalid={picked.length === 0}
          />
          <small className="flex justify-between gap-3 text-caption text-fg-dim">
            <span>The slides without results are picked for you.</span>
            {again ? <span className="text-warn">Runs again and adds a second set</span> : null}
          </small>
        </div>
      </SmallModalZone>
      <SmallModalZone title="Model">
        <ModelPicker
          groups={modelGroups(models)}
          value={modelId}
          onValueChange={setModelId}
          open={open}
          onOpenChange={setOpen}
          invalid={!model}
          footer={
            <Link
              to="/admin"
              search={{ scene: "addmodel" }}
              className="flex items-center gap-2 p-2.5 text-accent no-underline hover:underline"
            >
              <Icon name="plus" />
              Connect your own model
            </Link>
          }
          note="A run always uses the latest version, and the result set records which one."
        />
      </SmallModalZone>
      <SmallModalZone title="What happens">
        <div className="grid gap-3">
          {model && estimate ? (
            <>
              <OutcomeRow
                icon="layers"
                title="A new result set on each slide"
                detail={`Called ${model.title} · ${formatDayMonth(now())}. Result sets you already have stay as they are.`}
              />
              <OutcomeRow
                icon="calendar"
                title={
                  picked.length
                    ? `About ${estimate.total} min, done around ${estimate.doneAround}`
                    : "No slides picked yet"
                }
                detail={estimate.perSlide}
              />
            </>
          ) : null}
          <OutcomeRow
            icon="bell"
            title="You get a notification when it is done"
            detail="In the bell at the top, with a link to the slides."
          />
        </div>
      </SmallModalZone>
    </SmallModal>
  );
}
