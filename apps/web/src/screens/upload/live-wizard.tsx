import { Trans, useLingui } from "@lingui/react/macro";
import type { Project } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { FlowBar, FlowPage, type FlowStep } from "@parfocal/ui/components/flow-page";
import { Icon } from "@parfocal/ui/components/icon";
import { IngestSkipped } from "@parfocal/ui/components/ingest-skipped";
import { FactList } from "@parfocal/ui/components/inspector";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { Hint, Zone } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { type DragEvent, lazy, type ReactNode, Suspense, useRef, useState } from "react";
import {
  type DroppedItem,
  type DropRecord,
  fromFileList,
  isMirax,
  kindOf,
  type PairMode,
  readDropped,
  stemOf,
  uploadNameOf,
} from "../../upload/drop.ts";
import { dropStore, useDropStore } from "../../upload/drop-store.ts";
import { formatBytes, sameFile } from "../../upload/entries.ts";
import type { Duplicate } from "../../upload/place.ts";
import { minutesLeft, slideSteps, timeLeftText } from "../../upload/slide-steps.ts";
import { useSlideStates } from "../../upload/use-slide-states.ts";
import { useUploads } from "../../upload/use-uploads.ts";
import { DoneRow, ProblemZone } from "./check-step.tsx";
import { FolderShape, GroupHead, RemoveButton, ResultRow, SlideBlock } from "./files-step.tsx";
import { LinkImport } from "./link-import.tsx";
import { createLiveModel, freshLiveState, type LiveModel, type LiveState } from "./live-model.ts";
import { FileIcon, FileList, FileRow, TextLink, Thumb, useCrumbLink } from "./parts.tsx";
import { StepList } from "./progress-step.tsx";
import { ResultProblems } from "./result-problems.tsx";
import type { ResultUpload } from "./result-problems-model.ts";
import { plural } from "./state.ts";

export type LiveScene = "empty" | "files" | "check" | "progress" | "done";

const stepLabels = ["Files", "Check", "Upload"];
const stepScenes: LiveScene[] = ["files", "check", "progress"];

const shapeTree = [
  { name: "P07-upload/", note: "", depth: 0 },
  { name: "S26-04812/", note: "a case", depth: 1 },
  { name: "A1_HE.svs", note: "", depth: 2 },
  { name: "A1_HE.geojson", note: "results next to their slide", depth: 2 },
  { name: "A2_HE.svs", note: "", depth: 2 },
  { name: "A2_HE/cells.csv", note: "or in a folder named like the slide", depth: 2 },
  { name: "tumor_031.tif", note: "a loose slide", depth: 1 },
  { name: "results/tumor_031_prob.png", note: "you pick its slide", depth: 1 },
];

const ruleText: Record<PairMode, string> = {
  auto: "Grouped by folder, then name, then the slide ID inside",
  name: "Grouped by same name only",
  id: "Grouped by the slide ID inside each file",
};

const ruleOptions = [
  { value: "auto", label: "Folder, then name, then ID" },
  { value: "name", label: "Same name only" },
  { value: "id", label: "Slide ID inside only" },
];

const stepOfScene = (scene: LiveScene) =>
  scene === "check" ? 1 : scene === "progress" || scene === "done" ? 2 : 0;

type Change = (change: Partial<LiveState>) => void;

const ServerCheck = lazy(() => import("./server-check.tsx"));

export function LiveWizard({ project, scene }: { project: Project; scene: LiveScene }) {
  const { t } = useLingui();

  const navigate = useNavigate();
  const { engine, entries } = useUploads();
  const drop = useDropStore();
  const items = drop.projectId === project.id ? drop.items : [];
  const started = drop.projectId === project.id ? drop.started : [];
  const [state, setState] = useState<LiveState>(freshLiveState);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<"busy" | "error" | null>(null);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const model = createLiveModel(items, state);
  const openDuplicates = duplicates.filter(
    (duplicate) => state.duplicate[duplicate.path] === undefined,
  );
  const toFix = model.problems + openDuplicates.length;
  const base = items.length === 0 && scene !== "progress" && scene !== "done" ? "empty" : scene;
  const shown: LiveScene = started.length === 0 && stepOfScene(base) === 2 ? "empty" : base;
  const step = stepOfScene(shown);
  const set: Change = (change) => setState((current) => ({ ...current, ...change }));
  const go = (next: LiveScene, extra: Partial<LiveState> = {}) => {
    setState((current) => ({
      ...current,
      ...extra,
      maxStep: Math.max(current.maxStep, Math.min(stepOfScene(next), 1)),
    }));
    void navigate({
      to: "/projects/$projectId/upload",
      params: { projectId: project.id },
      search: { scene: next, flow: "live" },
    });
  };
  const toProject = () =>
    void navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
  const take = (taken: DroppedItem[]) => {
    if (taken.length === 0) return;
    dropStore.add(project.id, taken);
    if (shown === "empty") go("files");
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void readDropped(event.dataTransfer).then(take);
  };
  const startUpload = () => {
    if (phase === "busy") return;
    setPhase("busy");
    void import("./server-check.tsx")
      .then(({ placeAndUpload, placeInputOf }) =>
        placeAndUpload(engine, placeInputOf(project.id, model, state), items, (identities) => {
          dropStore.markStarted(identities);
          go("progress");
        }),
      )
      .catch(() => setPhase("error"));
  };
  const mine = entries.filter((entry) => started.some((identity) => sameFile(identity, entry)));
  const finished = mine.length > 0 && mine.every((entry) => entry.status === "done");
  const running = step === 2;
  const max = state.maxStep;
  const steps: FlowStep[] = stepLabels.map((label, index) => {
    const can = !running && index < 2 && index <= max && !(index === 1 && items.length === 0);
    const todo = index > max && index !== step;
    const why = running
      ? index < 2
        ? t`The upload has started. Files and checks are fixed now.`
        : ""
      : index === 2
        ? max >= 1
          ? t`Starts from the upload button on Check.`
          : t`Not reached yet. Check the files first.`
        : items.length === 0 && index === 1
          ? t`Add slides or result files first.`
          : can
            ? t`Go to ${label}`
            : t`Not reached yet. Use Next.`;
    return {
      label,
      ...(index === step
        ? {}
        : {
            state:
              running && index < 2
                ? ("done" as const)
                : todo
                  ? ("todo" as const)
                  : ("done" as const),
          }),
      ...(why ? { why } : {}),
      ...(index !== step && !can && !todo ? { locked: true } : {}),
    };
  });
  const renderLink = useCrumbLink();
  const clinical = project.privacy_mode === "clinical";
  const back = (
    <Button onClick={() => go("files")}>
      <Trans>Back</Trans>
    </Button>
  );
  const uploadLabel = t`Upload ${plural(model.uploadSlides.length, "slide")} and ${plural(model.uploadResults.length, "result")}`;
  const bar =
    step === 0 ? (
      <FlowBar
        back={
          <Button onClick={toProject}>
            <Trans>Cancel</Trans>
          </Button>
        }
        hint={
          items.length === 0
            ? t`Add slides, result files or both to go on.`
            : model.slides.length === 0
              ? t`Add at least one slide to go on. Results go with a slide.`
              : model.unplaced.length > 0
                ? t`${plural(model.unplaced.length, "result file")} wait${model.unplaced.length === 1 ? "s" : ""} in Not matched yet. With no slide ${model.unplaced.length === 1 ? "it stays" : "they stay"} out of the upload.`
                : t`Every result found its slide.`
        }
        next={
          <Button
            variant="primary"
            data-testid="upload-next"
            disabled={model.slides.length === 0}
            onClick={() => go("check", {})}
          >
            <Trans>Next</Trans>
          </Button>
        }
      />
    ) : step === 1 ? (
      <FlowBar
        back={back}
        hint={
          toFix > 0
            ? t`${plural(toFix, "file")} wait${toFix === 1 ? "s" : ""} for a fix. The rest upload now.`
            : t`Nothing needs you.`
        }
        next={
          <Button
            variant="primary"
            data-testid="start-upload"
            disabled={!model.canStart || phase === "busy"}
            onClick={startUpload}
          >
            <Icon name="upload" />
            {uploadLabel}
          </Button>
        }
      />
    ) : (
      <FlowBar
        hint={
          finished
            ? t`Every file is stored. Slides are being prepared for the viewer.`
            : t`Closing this window keeps the upload going in the jobs tray. Closing the browser tab pauses it, and you pick the files again to continue.`
        }
        next={
          <Button
            variant={finished ? "primary" : "secondary"}
            data-testid="close-upload"
            onClick={toProject}
          >
            {finished ? t`Done` : t`Close`}
          </Button>
        }
      />
    );
  return (
    <main
      className="flex min-h-0 flex-1 flex-col"
      data-testid="upload-page"
      data-scene={shown}
      onDragOver={(event) => {
        if (step === 2) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={step === 2 ? undefined : onDrop}
    >
      <FlowPage
        className="h-full"
        renderLink={renderLink}
        crumbs={[{ label: project.name, href: `/projects/${project.id}` }, { label: t`Upload` }]}
        title={t`Upload slides and results`}
        subtitle={
          <>
            <Trans>Into {project.name}</Trans> · <span className="font-mono">{project.code}</span> ·{" "}
            {clinical
              ? t`Clinical, patient fields are kept and every access is logged`
              : t`De-identified, so labels and patient names are removed on upload`}
          </>
        }
        steps={steps}
        current={step}
        onStepSelect={(index) => {
          const target = stepScenes[index];
          if (target && index < 2) go(target);
        }}
        bar={bar}
      >
        <Summary project={project} model={model} scene={shown} />
        {step === 0 ? (
          <FilesStep
            model={model}
            state={state}
            set={set}
            projectId={project.id}
            projectCode={project.code}
            scene={shown}
            dragging={dragging}
            take={take}
          />
        ) : step === 1 ? (
          <CheckStep
            model={model}
            state={state}
            set={set}
            projectId={project.id}
            startError={phase === "error"}
            toFix={toFix}
            take={take}
            duplicates={duplicates}
            onDuplicates={setDuplicates}
          />
        ) : (
          <UploadStep model={model} entries={mine} projectId={project.id} />
        )}
      </FlowPage>
    </main>
  );
}

function Summary({
  project,
  model,
  scene,
}: {
  project: Project;
  model: LiveModel;
  scene: LiveScene;
}) {
  const { t } = useLingui();

  const clinical = project.privacy_mode === "clinical";
  const where =
    model.caseCount > 0
      ? `${plural(model.caseCount, "new case")}${model.looseCount > 0 ? t`, ${model.looseCount} loose` : ""}`
      : model.slides.length > 0
        ? t`Loose slides, no case`
        : t`Not chosen yet`;
  return (
    <Zone title={t`Where the files go`} data-testid="upload-summary">
      <FactList
        tight
        rows={[
          {
            icon: "folder",
            label: t`Project`,
            value: (
              <>
                {project.name} · <span className="font-mono">{project.code}</span>
              </>
            ),
          },
          { icon: "slides", label: t`Cases`, value: where },
          {
            icon: "lock",
            label: t`Privacy`,
            value: clinical ? t`Clinical, patient fields are kept` : "De-identified",
          },
          {
            icon: "file",
            label: t`So far`,
            value:
              scene === "empty"
                ? t`Nothing yet`
                : `${plural(model.uploadSlides.length, "slide")}, ${plural(model.uploadResults.length, "result")}, ${formatBytes(model.bytes)}`,
          },
        ]}
      />
    </Zone>
  );
}

function LiveSlidePicker({
  slides,
  onPick,
  size = "sm",
}: {
  slides: DropRecord[];
  onPick: (slide: DropRecord) => void;
  size?: "sm" | "default";
}) {
  const { t } = useLingui();

  return (
    <Select
      items={slides.map((slide) => ({ value: slide.path, label: slide.path }))}
      onValueChange={(value) => {
        const slide = slides.find((candidate) => candidate.path === value);
        if (slide) onPick(slide);
      }}
    >
      <SelectTrigger size={size} aria-label={t`Choose a slide`} className="w-60">
        <SelectValue placeholder={t`Choose a slide`} />
      </SelectTrigger>
      <SelectContent>
        {slides.map((slide) => (
          <SelectItem key={slide.path} value={slide.path}>
            {slide.path}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Pickers({ take, label }: { take: (items: DroppedItem[]) => void; label: string }) {
  const { t } = useLingui();

  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  return (
    <>
      <span className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => files.current?.click()}>
          <Icon name="file" />
          {label}
        </Button>
        <Button onClick={() => folder.current?.click()}>
          <Icon name="folder" />
          <Trans>Choose a folder</Trans>
        </Button>
      </span>
      <input
        ref={files}
        type="file"
        multiple
        data-testid="file-input"
        aria-label={t`Choose slides or result files`}
        className="sr-only"
        onChange={(event) => {
          take(fromFileList(event.currentTarget.files));
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={folder}
        type="file"
        multiple
        data-testid="folder-input"
        aria-label={t`Choose a folder`}
        className="sr-only"
        {...{ webkitdirectory: "" }}
        onChange={(event) => {
          take(fromFileList(event.currentTarget.files));
          event.currentTarget.value = "";
        }}
      />
    </>
  );
}

function FilesStep({
  model,
  state,
  set,
  projectId,
  projectCode,
  scene,
  dragging,
  take,
}: {
  model: LiveModel<DroppedItem>;
  state: LiveState;
  set: Change;
  projectId: string;
  projectCode: string;
  scene: LiveScene;
  dragging: boolean;
  take: (items: DroppedItem[]) => void;
}) {
  const { t } = useLingui();

  const navigate = useNavigate();
  const adding = useRef<HTMLInputElement>(null);
  const [addingTo, setAddingTo] = useState<DropRecord | null>(null);
  const [source, setSource] = useState<"computer" | "link">("computer");
  const formats = (
    <button
      type="button"
      onClick={() =>
        void navigate({
          to: "/projects/$projectId/upload",
          params: { projectId },
          search: { scene: "files", formats: "help" },
        })
      }
      className="inline-flex min-h-6 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-body-sm font-medium text-fg-dim hover:text-fg"
    >
      <Icon name="help" />
      <Trans>What files work?</Trans>
    </button>
  );
  const sourceSwitch = (
    <div className="flex items-center gap-3">
      <SegmentedControl
        aria-label={t`Where the files are`}
        value={source}
        onValueChange={(value) => setSource(value === "link" ? "link" : "computer")}
        options={[
          { value: "computer", label: t`From this computer` },
          { value: "link", label: t`From a link or storage` },
        ]}
      />
      <span className="flex-1" />
      {formats}
    </div>
  );
  if (scene === "empty" && source === "link") {
    return (
      <>
        {sourceSwitch}
        <LinkImport projectId={projectId} projectCode={projectCode} />
      </>
    );
  }
  if (scene === "empty") {
    return (
      <>
        {sourceSwitch}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] items-stretch gap-(--space-zone)">
          <div
            data-testid="drop-area"
            className={cn(
              "grid min-h-95 content-center justify-items-center gap-2.5 rounded-[10px] border-[1.5px] border-dashed bg-surf-panel px-5 py-6 text-center text-body-sm leading-[1.45] text-fg-dim",
              dragging ? "border-accent" : "border-line-strong",
            )}
          >
            <Icon name="upload" size="md" />
            <b className="text-body font-semibold text-fg">
              <Trans>Drop slides, results or a whole folder</Trans>
            </b>
            <span>
              <Trans>
                Parfocal sorts them by slide. Slides up to 20 GB each, AI results are optional.
              </Trans>
            </span>
            <Pickers take={take} label={t`Choose files`} />
          </div>
          <FolderShape
            tree={shapeTree}
            open
            foldable={false}
            onToggle={() => undefined}
            openFormats={() => undefined}
          />
        </div>
      </>
    );
  }
  const slideBlock = (index: number) => {
    const slide = model.slides[index];
    if (slide === undefined) return null;
    const rows = model.resultsOf(index);
    return (
      <SlideBlock
        key={slide.path}
        slide={
          <FileRow
            lead={<Thumb />}
            name={slide.path}
            detail={`${formatBytes(slide.size)}${slide.size === 0 ? t` · empty file` : ""}`}
            end={
              <RemoveButton
                name={slide.path}
                onClick={() => set({ removed: { ...state.removed, [slide.path]: true } })}
              />
            }
          />
        }
        nested={
          <>
            {rows.map((result) => (
              <ResultRow
                key={result.item.path}
                name={result.item.path}
                detail={formatBytes(result.item.size)}
                how={result.how}
                end={
                  result.picked ? (
                    <TextLink
                      onClick={() => {
                        const placed = { ...state.placed };
                        delete placed[result.item.path];
                        set({ placed });
                      }}
                    >
                      <Trans>Undo</Trans>
                    </TextLink>
                  ) : (
                    <RemoveButton
                      name={result.item.path}
                      onClick={() =>
                        set({ removed: { ...state.removed, [result.item.path]: true } })
                      }
                    />
                  )
                }
              />
            ))}
            <div className="flex min-h-8.5 flex-wrap items-center gap-x-3 rounded-ctl border border-dashed border-line py-0.5 pr-1 pl-3">
              {rows.length === 0 ? (
                <>
                  <span className="text-body-sm text-fg-dim">
                    <Trans>No AI results yet. Fine, you can run a model later.</Trans>
                  </span>
                  <span className="flex-1" />
                </>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAddingTo(slide);
                  adding.current?.click();
                }}
              >
                <Icon name="plus" />
                <Trans>Add a result file for {stemOf(slide.path)}</Trans>
              </Button>
            </div>
          </>
        }
      />
    );
  };
  const list: ReactNode = model.groups.map((group) => (
    <span key={group.label ?? "loose"} className="contents">
      <GroupHead
        icon={group.label === null ? "slides" : "folder"}
        title={group.label === null ? t`Loose slides` : t`Case ${group.label}`}
        sub={
          group.label === null
            ? t`${plural(group.slides.length, "slide")}, no case number`
            : t`${plural(group.slides.length, "slide")} · case number from the folder name`
        }
      />
      {group.slides.map(slideBlock)}
    </span>
  ));
  return (
    <>
      <div className="flex justify-end">{formats}</div>
      <Zone
        title={t`Slides and their results`}
        end={
          <Hint>
            {plural(model.slides.length, "slide")} · {formatBytes(model.bytes)} ·{" "}
            <Trans>
              {model.matched} of {plural(model.results.length, "result")} matched
            </Trans>
          </Hint>
        }
      >
        <div
          data-testid="grouping-line"
          className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-body-sm text-fg-dim"
        >
          <span>
            {ruleText[state.pair]}.{" "}
            {state.cases === "names" ? t`Cases from folder names` : t`All slides kept loose`}.
          </span>
          <TextLink onClick={() => set({ ruleOpen: !state.ruleOpen })}>
            {state.ruleOpen ? t`Done` : t`Change`}
          </TextLink>
        </div>
        {state.ruleOpen ? (
          <div
            data-testid="pairing-rule"
            className="grid gap-2.5 rounded-[10px] border border-surf-edge bg-surf-panel px-3.5 py-3 text-body-sm text-fg-dim"
          >
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
              <span className="w-30">
                <Trans>Pair results by</Trans>
              </span>
              <SegmentedControl
                aria-label={t`Pair results by`}
                value={state.pair}
                onValueChange={(value) => set({ pair: value as PairMode, placed: {} })}
                options={ruleOptions}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
              <span className="w-30">
                <Trans>Cases</Trans>
              </span>
              <SegmentedControl
                aria-label={t`Cases`}
                value={state.cases}
                onValueChange={(value) => set({ cases: value as LiveState["cases"] })}
                options={[
                  { value: "names", label: t`From folder names` },
                  { value: "loose", label: t`Keep all loose` },
                ]}
              />
            </div>
          </div>
        ) : null}
        <FileList>
          {model.slides.length === 0 ? (
            <div className="p-3 text-body-sm text-fg-dim">
              <Trans>
                No slides in this upload yet. Drop slides below, or go back to the project.
              </Trans>
            </div>
          ) : (
            list
          )}
        </FileList>
        <input
          ref={adding}
          type="file"
          className="sr-only"
          data-testid="add-result-input"
          aria-label={t`Choose a result file`}
          onChange={(event) => {
            const chosen = fromFileList(event.currentTarget.files);
            event.currentTarget.value = "";
            const slide = addingTo;
            const first = chosen[0];
            if (slide === null || first === undefined) return;
            take(chosen);
            set({ placed: { ...state.placed, [first.path]: slide.path } });
          }}
        />
      </Zone>
      {model.unplaced.length > 0 ? (
        <Zone
          title={t`Not matched yet`}
          sub={t`Pick the slide each file goes with. A file with no slide stays out of this upload.`}
          end={<Hint>{plural(model.unplaced.length, "file")}</Hint>}
          data-testid="not-matched"
        >
          <FileList>
            {model.unplaced.map((result) => (
              <FileRow
                key={result.item.path}
                lead={<FileIcon />}
                name={result.item.path}
                detail={`${formatBytes(result.item.size)} · ${result.how}`}
                end={
                  <LiveSlidePicker
                    slides={model.slides}
                    onPick={(slide) =>
                      set({ placed: { ...state.placed, [result.item.path]: slide.path } })
                    }
                  />
                }
              />
            ))}
          </FileList>
        </Zone>
      ) : null}
      {model.others.length > 0 ? (
        <Hint>
          {plural(model.others.length, "file")} {model.others.length === 1 ? t`is` : t`are`}{" "}
          <Trans>not</Trans>{" "}
          {model.others.length === 1 ? t`a slide or a result` : t`slides or results`}
          <Trans> and stay out: {model.others.map((other) => other.path).join(", ")}</Trans>
        </Hint>
      ) : null}
      <div className="grid gap-3">
        <div
          data-testid="drop-more"
          className={cn(
            "flex flex-wrap items-center justify-center gap-3 rounded-[10px] border-[1.5px] border-dashed bg-surf-panel px-3.5 py-2.5 text-body-sm text-fg-dim",
            dragging ? "border-accent" : "border-line-strong",
          )}
        >
          <span className="inline-flex items-center gap-2">
            <Icon name="upload" />
            <Trans>Drop more slides, results or folders here</Trans>
          </span>
          <Pickers take={take} label={t`Choose files`} />
        </div>
        <FolderShape
          tree={shapeTree}
          open={state.shapeOpen}
          foldable
          onToggle={() => set({ shapeOpen: !state.shapeOpen })}
          openFormats={() => undefined}
        />
      </div>
    </>
  );
}

function CheckStep({
  model,
  state,
  set,
  projectId,
  startError,
  toFix,
  take,
  duplicates,
  onDuplicates,
}: {
  model: LiveModel<DroppedItem>;
  state: LiveState;
  set: Change;
  projectId: string;
  startError: boolean;
  toFix: number;
  take: (taken: DroppedItem[]) => void;
  duplicates: readonly Duplicate[];
  onDuplicates: (found: Duplicate[]) => void;
}) {
  const { t } = useLingui();

  const left = model.leftOut.length;
  const dataFolder = useRef<HTMLInputElement>(null);
  const [addingFolderTo, setAddingFolderTo] = useState<string | null>(null);
  const lead =
    toFix > 0
      ? t`${plural(toFix, "file")} need${toFix === 1 ? "s" : ""} a look. A file with a problem waits until it is fixed, the rest upload.`
      : left > 0
        ? t`${plural(left, "result file")} ${left === 1 ? "is" : "are"} left out. The other files are fine and upload.`
        : t`Every file is readable and has its place. Nothing needs you.`;
  const placedBack = model.results.filter((result) => result.picked);
  return (
    <>
      <Zone title={t`In this upload`} sub={lead} data-testid="check-summary">
        <FactList
          rows={[
            { icon: "slides", label: t`Slides`, value: String(model.uploadSlides.length) },
            {
              icon: "layers",
              label: "AI results",
              value: left
                ? t`${plural(model.uploadResults.length, "file")}, ${left} left out`
                : plural(model.uploadResults.length, "file"),
            },
            {
              icon: "link",
              label: t`Matched`,
              value: `${model.matched} of ${model.results.length}`,
            },
            {
              icon: "warn",
              label: t`To fix`,
              value: toFix ? plural(toFix, "file") : t`Nothing`,
            },
            ...(model.others.length > 0
              ? [
                  {
                    icon: "file" as const,
                    label: t`Not uploaded`,
                    value: `${plural(model.others.length, "file")} that ${model.others.length === 1 ? "is" : "are"} not slides or results`,
                  },
                ]
              : []),
          ]}
        />
      </Zone>
      <Suspense fallback={null}>
        <ServerCheck
          projectId={projectId}
          model={model}
          state={state}
          startError={startError}
          duplicates={duplicates}
          onDuplicates={onDuplicates}
          decide={(path, choice) => {
            const next = { ...state.duplicate };
            if (choice === null) delete next[path];
            else next[path] = choice;
            set({ duplicate: next });
          }}
        />
      </Suspense>
      {model.unplaced.map((result) => (
        <ProblemZone
          key={result.item.path}
          icon="link"
          tag={t`No slide yet`}
          tone="warn"
          title={t`This result file has no slide yet`}
          file={result.item.path}
          text={t`Nothing next to it or in its name says which slide it belongs to. Pick its slide, or leave it out of this upload.`}
          actions={
            <>
              <LiveSlidePicker
                slides={model.slides}
                size="default"
                onPick={(slide) =>
                  set({ placed: { ...state.placed, [result.item.path]: slide.path } })
                }
              />
              <Button
                variant="ghost"
                onClick={() => set({ left: { ...state.left, [result.item.path]: true } })}
              >
                <Trans>Leave it out</Trans>
              </Button>
            </>
          }
        />
      ))}
      {model.mrxsWaiting.map((slide) => (
        <ProblemZone
          key={slide.path}
          icon="folder"
          tag={t`Data folder missing`}
          tone="warn"
          title={t`This MRXS slide has no data folder`}
          file={slide.path}
          text={t`An MRXS slide is the .mrxs file plus a folder named ${stemOf(slide.path)} with its data files. Add that folder, or leave the slide out. It waits until you do.`}
          actions={
            <>
              <Button
                onClick={() => {
                  setAddingFolderTo(slide.path);
                  dataFolder.current?.click();
                }}
              >
                <Icon name="folder" />
                <Trans>Add the folder</Trans>
              </Button>
              <Button
                variant="ghost"
                onClick={() => set({ left: { ...state.left, [slide.path]: true } })}
              >
                <Trans>Leave it out</Trans>
              </Button>
            </>
          }
        />
      ))}
      {model.mrxsLeftOut.map((slide) => (
        <DoneRow
          key={slide.path}
          file={slide.path}
          what={t`Left out of this upload`}
          out
          onUndo={() => {
            const next = { ...state.left };
            delete next[slide.path];
            set({ left: next });
          }}
        />
      ))}
      <input
        ref={dataFolder}
        type="file"
        multiple
        data-testid="data-folder-input"
        aria-label={t`Choose the data folder`}
        className="sr-only"
        {...{ webkitdirectory: "" }}
        onChange={(event) => {
          const chosen = fromFileList(event.currentTarget.files);
          event.currentTarget.value = "";
          const slide = model.slides.find((candidate) => candidate.path === addingFolderTo);
          if (slide === undefined) return;
          take(
            chosen.map((item) => ({
              ...item,
              path: `${model.dataFolderOf(slide)}${item.path.slice(item.path.indexOf("/") + 1)}`,
            })),
          );
        }}
      />
      {model.empty.map((item) => (
        <ProblemZone
          key={item.path}
          icon="x-circle"
          tag={t`Empty file`}
          tone="bad"
          title={
            kindOf(item.path) === "slide"
              ? t`This slide cannot be read`
              : t`This file has nothing in it`
          }
          file={item.path}
          text={t`The file is 0 bytes, so there is nothing to read. It waits until you take it out or choose it again.`}
          actions={
            <Button onClick={() => set({ removed: { ...state.removed, [item.path]: true } })}>
              <Trans>Remove from this upload</Trans>
            </Button>
          }
        />
      ))}
      {placedBack.map((result) => (
        <DoneRow
          key={result.item.path}
          file={result.item.path}
          what={t`Goes with ${model.slides[result.slide ?? 0]?.path ?? ""}`}
          onUndo={() => {
            const placed = { ...state.placed };
            delete placed[result.item.path];
            set({ placed });
          }}
        />
      ))}
      {model.leftOut.map((result) => (
        <DoneRow
          key={result.item.path}
          file={result.item.path}
          what={t`Left out of this upload`}
          out
          onUndo={() => {
            const next = { ...state.left };
            delete next[result.item.path];
            set({ left: next });
          }}
        />
      ))}
    </>
  );
}

function UploadStep({
  model,
  entries,
  projectId,
}: {
  model: LiveModel<DroppedItem>;
  entries: ReturnType<typeof useUploads>["entries"];
  projectId: string;
}) {
  const { t } = useLingui();

  const [startedAt] = useState(() => Date.now());
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [leaveBare, setLeaveBare] = useState(false);
  const slideOf = (entry: (typeof entries)[number]) =>
    model.slides.findIndex(
      (slide) =>
        uploadNameOf(slide.path) === entry.name &&
        (isMirax(slide.path) || slide.size === entry.size),
    );
  const slideEntries = entries.filter((entry) => slideOf(entry) >= 0);
  const states = useSlideStates(
    slideEntries.flatMap((entry) =>
      entry.status === "done" && entry.uploadId !== undefined ? [entry.uploadId] : [],
    ),
  );
  const resultEntries = entries.filter(
    (entry) => slideOf(entry) < 0 && entry.status === "done" && entry.uploadId !== undefined,
  );
  const resultStates = useSlideStates(
    resultEntries.flatMap((entry) => (entry.uploadId === undefined ? [] : [entry.uploadId])),
  );
  const resultUploads: ResultUpload[] = resultEntries.flatMap((entry) => {
    const found = entry.uploadId === undefined ? undefined : resultStates[entry.uploadId];
    return found === undefined
      ? []
      : [
          {
            uploadId: found.upload_id,
            name: entry.name,
            status: found.status,
            reason: found.reason,
            message: found.message,
          },
        ];
  });
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  const sent = entries.reduce(
    (sum, entry) => sum + (entry.status === "done" ? entry.size : entry.bytesUploaded),
    0,
  );
  const percent = total === 0 ? 0 : Math.min(100, Math.floor((sent / total) * 100));
  const done = entries.filter((entry) => entry.status === "done").length;
  const left = timeLeftText(minutesLeft(sent, total, Date.now() - startedAt));
  const bare = slideEntries.filter(
    (entry) =>
      (entry.uploadId === undefined ? undefined : states[entry.uploadId])?.status === "ready" &&
      model.resultsOf(slideOf(entry)).every((result) => result.item.size === 0 || result.left),
  );
  const bareSlideIds = bare.flatMap((entry) => {
    const id = entry.uploadId === undefined ? undefined : states[entry.uploadId]?.slide_id;
    return id ? [id] : [];
  });
  return (
    <>
      <Zone title={t`Everything`} data-testid="upload-overall">
        <ProgressBar
          value={percent}
          tone={done === entries.length && entries.length > 0 ? "ok" : "accent"}
          label={t`${done} of ${plural(entries.length, "file")} uploaded`}
          valueText={t`${percent}% · ${formatBytes(sent)} of ${formatBytes(total)}${left}`}
        />
      </Zone>
      <Zone
        title={t`Each file`}
        sub={t`${plural(model.uploadSlides.length, "slide")} and ${plural(model.uploadResults.length, "result")}`}
      >
        <FileList>
          {entries.map((entry) => {
            const filePercent =
              entry.size === 0
                ? 0
                : entry.status === "done"
                  ? 100
                  : Math.min(100, Math.floor((entry.bytesUploaded / entry.size) * 100));
            const slideIndex = slideOf(entry);
            const state = entry.uploadId === undefined ? undefined : states[entry.uploadId];
            const steps =
              slideIndex >= 0
                ? slideSteps({
                    uploaded: entry.status === "done",
                    state,
                    hasResults: model
                      .resultsOf(slideIndex)
                      .some((result) => result.item.size > 0 && !result.left),
                  })
                : null;
            const open = Boolean(openRows[entry.id]);
            return (
              <div
                key={entry.id}
                data-testid="upload-file-row"
                data-status={entry.status}
                data-ingest={state?.status ?? ""}
                className="border-line [&+&]:border-t"
              >
                <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
                  <ProgressBar
                    value={filePercent}
                    tone={
                      entry.status === "done" ? "ok" : entry.status === "failed" ? "bad" : "accent"
                    }
                    label={<span className="font-mono">{entry.name}</span>}
                    valueText={
                      state?.status === "skipped"
                        ? t`Skipped`
                        : entry.status === "done"
                          ? t`Uploaded`
                          : entry.status === "failed"
                            ? t`Stopped. What was stored is kept`
                            : entry.status === "retrying"
                              ? t`Connection lost. Trying again`
                              : entry.status === "paused"
                                ? t`Paused at ${filePercent}%`
                                : `${filePercent}%`
                    }
                  />
                  {steps !== null && !steps.skipped ? (
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={t`${steps.done} of ${steps.rows.length} processing steps of ${entry.name}`}
                      title={t`${open ? "Hide" : "Show"} the processing steps`}
                      onClick={() => setOpenRows({ ...openRows, [entry.id]: !open })}
                      className="inline-flex h-6.5 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-transparent px-2 text-caption text-fg-dim hover:border-line-strong hover:text-fg"
                    >
                      <span className="font-mono">
                        <Trans>
                          {steps.done} of {steps.rows.length}
                        </Trans>
                      </span>
                      <Icon name="down" className={cn(open && "rotate-180")} />
                    </button>
                  ) : null}
                </div>
                {steps?.skipped ? (
                  <IngestSkipped className="mr-3 mb-3 ml-3" fileName={entry.name} />
                ) : null}
                {steps !== null && open && !steps.skipped ? (
                  <StepList
                    slide={{
                      steps: steps.rows,
                      steps_done: steps.done,
                      running: steps.running
                        ? {
                            percent: steps.done === 0 ? filePercent : null,
                            text: steps.done === 0 ? `${filePercent}%` : t`Working`,
                          }
                        : null,
                    }}
                    projectId={projectId}
                    firstSlideId={state?.slide_id ?? undefined}
                  />
                ) : null}
              </div>
            );
          })}
        </FileList>
      </Zone>
      <ResultProblems uploads={resultUploads} projectId={projectId} />
      {bare.length === 0 ? null : leaveBare ? (
        <Zone
          title={t`${plural(bare.length, "slide stays", "slides stay")} without results`}
          sub={t`Add a result file or run a model on them any time, from the project or from the slide.`}
          end={
            <Button size="sm" variant="ghost" onClick={() => setLeaveBare(false)}>
              <Trans>Undo</Trans>
            </Button>
          }
        />
      ) : (
        <Zone
          highlight
          title={t`${plural(bare.length, "slide has", "slides have")} no results`}
          sub={t`Run a model on them now, or leave them and add results later.`}
          data-testid="no-results-zone"
        >
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button
              nativeButton={false}
              render={
                <Link
                  to="/projects/$projectId/run-model"
                  params={{ projectId }}
                  search={{ slides: bareSlideIds }}
                />
              }
            >
              <Icon name="smart" />
              <Trans>Run a model</Trans>
            </Button>
            <Button variant="ghost" onClick={() => setLeaveBare(true)}>
              <Trans>Leave them</Trans>
            </Button>
          </div>
        </Zone>
      )}
    </>
  );
}
