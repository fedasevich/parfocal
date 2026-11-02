import {
  type Project,
  type UploadBatch,
  useGetProject,
  useGetUploadBatch,
  useListMySlides,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { DropOverlay } from "@parfocal/ui/components/drop-overlay";
import {
  FlowBar,
  FlowPage,
  type FlowStep,
  type StepState,
} from "@parfocal/ui/components/flow-page";
import { Icon } from "@parfocal/ui/components/icon";
import { CategoryTag } from "@parfocal/ui/components/tag";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useOpenJobsTray } from "../../shell/jobs-tray.tsx";
import { okData } from "../placeholder.tsx";
import { useMockToast } from "../project/mock-toast.tsx";
import { ProjectPage } from "../project/project-page.tsx";
import { CheckStep } from "./check-step.tsx";
import { FilesStep } from "./files-step.tsx";
import { FormatsDrawer, ImportsModal } from "./overlays.tsx";
import { useCrumbLink } from "./parts.tsx";
import { DoneStep, ProgressStep } from "./progress-step.tsx";
import {
  createUploadModel,
  plural,
  stateForScene,
  stepOf,
  type UploadModel,
  type UploadScene,
  type UploadState,
} from "./state.ts";
import { ViewerFlow } from "./viewer-flow.tsx";

export type FormatsScene = "help" | "check";

type UploadPageProps = {
  projectId: string;
  scene: UploadScene;
  flow: string;
  formats: FormatsScene | undefined;
};

const stepLabels = ["Files", "Check", "Upload"];
const stepScenes: UploadScene[] = ["files", "check", "progress"];
const behindFormats: UploadScene[] = ["drop", "tray", "viewer", "api"];

export function UploadPage(props: UploadPageProps) {
  const project = okData(useGetProject(props.projectId).data);
  const batch = useGetUploadBatch(props.projectId).data?.data;
  if (project === undefined || batch === undefined) {
    return (
      <main className="grid flex-1 place-items-center p-8 text-body-sm text-fg-dim">
        Loading the upload…
      </main>
    );
  }
  return <UploadFlow {...props} project={project} batch={batch} />;
}

function UploadFlow({
  projectId,
  scene,
  flow,
  formats,
  project,
  batch,
}: UploadPageProps & { project: Project; batch: UploadBatch }) {
  const navigate = useNavigate();
  const toast = useMockToast();
  useOpenJobsTray(scene === "tray");
  const [state, setState] = useState<UploadState & { maxStep: number }>(() => ({
    ...stateForScene(scene, batch),
    maxStep: Math.min(stepOf(scene), 1),
  }));
  const firstSlide = okData(useListMySlides({ project_id: projectId }).data)?.slides[0]?.id;
  const set = (change: Partial<UploadState>) => setState({ ...state, ...change });
  const model = createUploadModel(batch, state);
  const go = (next: UploadScene, extra: Partial<UploadState> = {}) => {
    const fixes =
      next === "allgood"
        ? { fixed: Object.fromEntries(batch.problems.map((_, index) => [index, true])) }
        : {};
    const fresh =
      next === "dup" || next === "storagefull" || next === "unmatched" || next === "sourceoff"
        ? { removedSlides: {}, removedResults: {}, added: {} }
        : {};
    setState({
      ...state,
      ...fixes,
      ...fresh,
      ...extra,
      maxStep: stepOf(next) === 2 ? 2 : Math.min(Math.max(state.maxStep, stepOf(next)), 1),
    });
    void navigate({
      to: "/projects/$projectId/upload",
      params: { projectId },
      search: { scene: next, flow },
    });
  };
  const toProject = () => void navigate({ to: "/projects/$projectId", params: { projectId } });
  const openFormats = (which: FormatsScene = "help") =>
    void navigate({
      to: "/projects/$projectId/upload",
      params: { projectId },
      search: { scene, flow, formats: which },
    });
  const closeFormats = () =>
    void navigate({
      to: "/projects/$projectId/upload",
      params: { projectId },
      search: { scene, flow },
    });

  const background = formats && behindFormats.includes(scene) ? "files" : scene;
  const drawer = formats ? (
    <FormatsDrawer
      batch={batch}
      checking={formats === "check"}
      onCheck={() => openFormats("check")}
      onClear={() => openFormats("help")}
      onClose={closeFormats}
      toast={toast.show}
    />
  ) : null;

  if (background === "drop" || background === "tray") {
    return (
      <ProjectPage
        projectId={projectId}
        view={{ tab: "slides" }}
        overlay={
          background === "drop" ? (
            <DropOverlay
              projectCode={project.code}
              slides={batch.slides.length}
              results={batch.results.length}
              onDrop={() => go("files")}
            />
          ) : null
        }
      />
    );
  }
  if (background === "api") {
    return (
      <ProjectPage
        projectId={projectId}
        view={{ tab: "settings" }}
        overlay={
          <ImportsModal
            projectId={projectId}
            projectCode={project.code}
            onClose={() =>
              void navigate({
                to: "/projects/$projectId",
                params: { projectId },
                search: { tab: "settings" },
              })
            }
          />
        }
      />
    );
  }
  if (background === "viewer") {
    const slideHref = firstSlide
      ? `/projects/${projectId}/slides/${firstSlide}`
      : `/projects/${projectId}`;
    return (
      <main className="flex min-h-0 flex-1 flex-col">
        <ViewerFlow
          project={project}
          batch={batch}
          slideHref={slideHref}
          onCancel={() =>
            void navigate({
              href: slideHref,
            })
          }
          onAdded={(message) => {
            toast.show(message);
            void navigate({ href: slideHref });
          }}
        />
        {toast.node}
      </main>
    );
  }

  const step = stepOf(background);
  const started = step === 2;
  const max = state.maxStep;
  const open = model.openIn(background);
  const steps: FlowStep[] = stepLabels.map((label, index) => {
    const stateOf: StepState | undefined =
      index === step
        ? undefined
        : started && index < 2
          ? "done"
          : index > max
            ? "todo"
            : index === 1 && open
              ? "warn"
              : "done";
    const can = !started && index < 2 && index <= max && !(index === 1 && background === "empty");
    const why = started
      ? index < 2
        ? "The upload has started. Files and checks are fixed now."
        : ""
      : index === 2
        ? max >= 1
          ? "Starts from the upload button on Check."
          : "Not reached yet. Check the files first."
        : background === "empty"
          ? "Add slides or result files first."
          : can && index === 1 && open
            ? `Go to Check. ${open} file${open > 1 ? "s wait" : " waits"} for a fix`
            : can
              ? `Go to ${label}`
              : "Not reached yet. Use Next.";
    return {
      label,
      ...(stateOf ? { state: stateOf } : {}),
      ...(why ? { why } : {}),
      ...(index !== step && !can && stateOf !== "todo" ? { locked: true } : {}),
    };
  });
  const main =
    step === 1 ? (
      <CheckStep
        batch={batch}
        model={model}
        state={state}
        set={set}
        scene={background}
        projectId={projectId}
        projectCode={project.code}
        toast={toast.show}
      />
    ) : background === "progress" || background === "sourceoff" ? (
      <ProgressStep
        batch={batch}
        model={model}
        state={state}
        set={set}
        scene={background}
        projectId={projectId}
        firstSlideId={firstSlide}
      />
    ) : background === "done" ? (
      <DoneStep
        batch={batch}
        model={model}
        state={state}
        set={set}
        projectId={projectId}
        projectCode={project.code}
      />
    ) : (
      <FilesStep
        batch={batch}
        model={model}
        state={state}
        set={set}
        scene={background}
        projectId={projectId}
        projectCode={project.code}
        go={go}
        openFormats={() => openFormats("help")}
      />
    );
  return (
    <main className="flex min-h-0 flex-1 flex-col" data-testid="upload-page" data-scene={scene}>
      <UploadFrame
        project={project}
        steps={steps}
        step={step}
        onStep={(index) => {
          const target = stepScenes[index];
          if (target) go(target);
        }}
        bar={
          <UploadBar
            batch={batch}
            model={model}
            state={state}
            set={set}
            scene={background}
            go={go}
            close={toProject}
            projectId={projectId}
            projectCode={project.code}
          />
        }
      >
        {main}
      </UploadFrame>
      {drawer}
      {toast.node}
    </main>
  );
}

function UploadFrame({
  project,
  steps,
  step,
  onStep,
  bar,
  children,
}: {
  project: Project;
  steps: FlowStep[];
  step: number;
  onStep: (index: number) => void;
  bar: ReactNode;
  children: ReactNode;
}) {
  const renderLink = useCrumbLink();
  const clinical = project.privacy_mode === "clinical";
  return (
    <FlowPage
      className="h-full"
      renderLink={renderLink}
      crumbs={[{ label: project.name, href: `/projects/${project.id}` }, { label: "Upload" }]}
      title="Upload slides and results"
      subtitle={
        <>
          Into {project.name} · <span className="font-mono">{project.code}</span> ·{" "}
          {clinical
            ? "Clinical, patient fields are kept and every access is logged"
            : "De-identified, so labels and patient names are removed on upload"}
        </>
      }
      steps={steps}
      current={step}
      onStepSelect={onStep}
      bar={bar}
    >
      {children}
    </FlowPage>
  );
}

function UploadBar({
  batch,
  model,
  state,
  set,
  scene,
  go,
  close,
  projectId,
  projectCode,
}: {
  batch: UploadBatch;
  model: UploadModel;
  state: UploadState;
  set: (change: Partial<UploadState>) => void;
  scene: UploadScene;
  go: (scene: UploadScene, extra?: Partial<UploadState>) => void;
  close: () => void;
  projectId: string;
  projectCode: string;
}) {
  const navigate = useNavigate();
  const step = stepOf(scene);
  const open = model.openIn(scene);
  const left = model.leftCount;
  const back = <Button onClick={() => go("files")}>Back</Button>;
  const start = (label: string) => (
    <Button variant="primary" data-testid="start-upload" onClick={() => go("progress")}>
      <Icon name="upload" />
      {label}
    </Button>
  );
  const off = (label: ReactNode, why: string) => (
    <Button variant="primary" disabled title={why}>
      {label}
    </Button>
  );
  const both = (results: number) =>
    `${plural(model.slides.length, "slide")} and ${plural(results, "result")}`;
  if (scene === "storagefull") {
    const full = !state.trimmed;
    const freeGb = (batch.storage.needed_gb - batch.storage.left_gb).toFixed(1);
    const why = `Free ${freeGb} GB in ${projectCode} or ask an admin for a larger allowance.`;
    const out = model.slides.length - batch.storage.trimmed_slides;
    return (
      <FlowBar
        back={back}
        hint={
          full
            ? why
            : `${out} slides are out. ${batch.storage.trimmed_gb} GB fits in the ${batch.storage.left_gb} GB left in ${projectCode}.`
        }
        next={
          full
            ? off(
                <>
                  <Icon name="upload" />
                  Upload {both(model.resultCount)}
                </>,
                why,
              )
            : start(`Upload ${batch.storage.trimmed_slides} slides, ${out} left out`)
        }
      />
    );
  }
  if (scene === "unmatched") {
    const waits = model.resultTo(2).slide === null;
    return (
      <FlowBar
        back={back}
        hint={
          waits && !state.unmatchedOut
            ? "1 file waits for a slide. Without one it stays out."
            : "Nothing needs you."
        }
        next={start(
          waits
            ? `Upload ${both(model.resultCount - 1)}, 1 left out`
            : `Upload ${both(model.resultCount)}`,
        )}
      />
    );
  }
  if (step === 1) {
    const label = open
      ? `Upload ${plural(model.files - open, "file")}, ${open} wait`
      : left
        ? `Upload ${both(model.resultCount - left)}, ${left} left out`
        : `Upload ${both(model.resultCount)}`;
    const hint = open
      ? `${open} file${open > 1 ? "s wait" : " waits"} for a fix. The rest upload now.`
      : left
        ? `${left} result file${left > 1 ? "s are" : " is"} left out. Add ${left > 1 ? "them" : "it"} to the project later.`
        : "Nothing needs you.";
    return (
      <FlowBar
        back={back}
        hint={hint}
        next={
          <span className="flex items-center gap-2">
            {open ? (
              <Button
                onClick={() => {
                  const leftOut = { ...state.left };
                  batch.problems.forEach((_, index) => {
                    if (model.problemIn(index) && !state.fixed[index]) leftOut[index] = true;
                  });
                  set({ left: leftOut });
                }}
              >
                Leave {open > 1 ? "them" : "it"} out
              </Button>
            ) : null}
            {start(label)}
          </span>
        }
      />
    );
  }
  if (scene === "progress" || scene === "sourceoff") {
    return (
      <FlowBar
        hint="The upload keeps going if you leave this page or close the tab."
        next={
          <span className="flex items-center gap-2">
            <span className="mr-1.5 inline-flex items-center gap-1.5">
              <CategoryTag tone="info">Mock only</CategoryTag>
              <Button variant="ghost" onClick={() => go("done")}>
                Jump to the end
              </Button>
            </span>
            <Button onClick={close}>Close</Button>
          </span>
        }
      />
    );
  }
  if (scene === "done") {
    return (
      <FlowBar
        hint="Every result set records its file, model and version."
        next={
          <span className="flex items-center gap-2">
            <Button
              onClick={() =>
                void navigate({ to: "/projects/$projectId/tasks/new", params: { projectId } })
              }
            >
              <Icon name="users" />
              Create a review task
            </Button>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </span>
        }
      />
    );
  }
  const remote = scene === "link" || scene === "remote";
  const none = !remote && model.files === 0;
  const out = model.resultCount - model.matched;
  const checked = remote && state.checked[scene === "link" ? "link" : "remote"];
  const duplicate = batch.slides[batch.duplicate.slide]?.name ?? "";
  const hint = none
    ? "Every file is removed. Drop slides or result files to go on."
    : scene === "dup"
      ? state.duplicate === "skip"
        ? `${duplicate} is skipped. The other ${model.slides.length - 1} slides upload.`
        : `${duplicate} replaces the slide in ${projectCode}. Its reviews stay.`
      : remote
        ? checked
          ? "Nothing is fetched until you start the upload."
          : "Check the address first."
        : scene === "empty"
          ? "Add slides, result files or both to go on."
          : out
            ? `${out} result file${out > 1 ? "s wait" : " waits"} in Not matched yet. With no slide it stays out of the upload.`
            : "Every result found its slide.";
  const blocked = scene === "empty" || none || (remote && !checked);
  return (
    <FlowBar
      back={<Button onClick={close}>Cancel</Button>}
      hint={hint}
      next={
        blocked ? (
          off("Next", hint)
        ) : (
          <Button variant="primary" data-testid="upload-next" onClick={() => go("check")}>
            Next
          </Button>
        )
      }
    />
  );
}
