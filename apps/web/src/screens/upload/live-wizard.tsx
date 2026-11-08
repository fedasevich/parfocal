import type { Project } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { FlowBar, FlowPage, type FlowStep } from "@parfocal/ui/components/flow-page";
import { Icon } from "@parfocal/ui/components/icon";
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
import { useNavigate } from "@tanstack/react-router";
import { type DragEvent, lazy, type ReactNode, Suspense, useRef, useState } from "react";
import {
  type DroppedItem,
  type DropRecord,
  fromFileList,
  type PairMode,
  readDropped,
  stemOf,
} from "../../upload/drop.ts";
import { dropStore, useDropStore } from "../../upload/drop-store.ts";
import { formatBytes, sameFile } from "../../upload/entries.ts";
import { useUploads } from "../../upload/use-uploads.ts";
import { DoneRow, ProblemZone } from "./check-step.tsx";
import { FolderShape, GroupHead, RemoveButton, ResultRow, SlideBlock } from "./files-step.tsx";
import { LinkImport } from "./link-import.tsx";
import { createLiveModel, freshLiveState, type LiveModel, type LiveState } from "./live-model.ts";
import { FileIcon, FileList, FileRow, TextLink, Thumb, useCrumbLink } from "./parts.tsx";
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
  const navigate = useNavigate();
  const { engine, entries } = useUploads();
  const drop = useDropStore();
  const items = drop.projectId === project.id ? drop.items : [];
  const started = drop.projectId === project.id ? drop.started : [];
  const [state, setState] = useState<LiveState>(freshLiveState);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<"busy" | "error" | null>(null);
  const model = createLiveModel(items, state);
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
        ? "The upload has started. Files and checks are fixed now."
        : ""
      : index === 2
        ? max >= 1
          ? "Starts from the upload button on Check."
          : "Not reached yet. Check the files first."
        : items.length === 0 && index === 1
          ? "Add slides or result files first."
          : can
            ? `Go to ${label}`
            : "Not reached yet. Use Next.";
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
  const back = <Button onClick={() => go("files")}>Back</Button>;
  const uploadLabel = `Upload ${plural(model.uploadSlides.length, "slide")} and ${plural(model.uploadResults.length, "result")}`;
  const bar =
    step === 0 ? (
      <FlowBar
        back={<Button onClick={toProject}>Cancel</Button>}
        hint={
          items.length === 0
            ? "Add slides, result files or both to go on."
            : model.slides.length === 0
              ? "Add at least one slide to go on. Results go with a slide."
              : model.unplaced.length > 0
                ? `${plural(model.unplaced.length, "result file")} wait${model.unplaced.length === 1 ? "s" : ""} in Not matched yet. With no slide ${model.unplaced.length === 1 ? "it stays" : "they stay"} out of the upload.`
                : "Every result found its slide."
        }
        next={
          <Button
            variant="primary"
            data-testid="upload-next"
            disabled={model.slides.length === 0}
            onClick={() => go("check", {})}
          >
            Next
          </Button>
        }
      />
    ) : step === 1 ? (
      <FlowBar
        back={back}
        hint={
          model.problems > 0
            ? `${plural(model.problems, "file")} wait${model.problems === 1 ? "s" : ""} for a fix. The rest upload now.`
            : "Nothing needs you."
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
            ? "Every file is stored. Slides are being prepared for the viewer."
            : "Closing this window keeps the upload going in the jobs tray. Closing the browser tab pauses it, and you pick the files again to continue."
        }
        next={
          <Button
            variant={finished ? "primary" : "secondary"}
            data-testid="close-upload"
            onClick={toProject}
          >
            {finished ? "Done" : "Close"}
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
          />
        ) : (
          <UploadStep model={model} entries={mine} />
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
  const clinical = project.privacy_mode === "clinical";
  const where =
    model.caseCount > 0
      ? `${plural(model.caseCount, "new case")}${model.looseCount > 0 ? `, ${model.looseCount} loose` : ""}`
      : model.slides.length > 0
        ? "Loose slides, no case"
        : "Not chosen yet";
  return (
    <Zone title="Where the files go" data-testid="upload-summary">
      <FactList
        tight
        rows={[
          {
            icon: "folder",
            label: "Project",
            value: (
              <>
                {project.name} · <span className="font-mono">{project.code}</span>
              </>
            ),
          },
          { icon: "slides", label: "Cases", value: where },
          {
            icon: "lock",
            label: "Privacy",
            value: clinical ? "Clinical, patient fields are kept" : "De-identified",
          },
          {
            icon: "file",
            label: "So far",
            value:
              scene === "empty"
                ? "Nothing yet"
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
  return (
    <Select
      items={slides.map((slide) => ({ value: slide.path, label: slide.path }))}
      onValueChange={(value) => {
        const slide = slides.find((candidate) => candidate.path === value);
        if (slide) onPick(slide);
      }}
    >
      <SelectTrigger size={size} aria-label="Choose a slide" className="w-60">
        <SelectValue placeholder="Choose a slide" />
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
          Choose a folder
        </Button>
      </span>
      <input
        ref={files}
        type="file"
        multiple
        data-testid="file-input"
        aria-label="Choose slides or result files"
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
        aria-label="Choose a folder"
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
      What files work?
    </button>
  );
  const sourceSwitch = (
    <div className="flex items-center gap-3">
      <SegmentedControl
        aria-label="Where the files are"
        value={source}
        onValueChange={(value) => setSource(value === "link" ? "link" : "computer")}
        options={[
          { value: "computer", label: "From this computer" },
          { value: "link", label: "From a link or storage" },
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
              Drop slides, results or a whole folder
            </b>
            <span>
              Parfocal sorts them by slide. Slides up to 20 GB each, AI results are optional.
            </span>
            <Pickers take={take} label="Choose files" />
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
            detail={`${formatBytes(slide.size)}${slide.size === 0 ? " · empty file" : ""}`}
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
                      Undo
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
                    No AI results yet. Fine, you can run a model later.
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
                Add a result file for {stemOf(slide.path)}
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
        title={group.label === null ? "Loose slides" : `Case ${group.label}`}
        sub={
          group.label === null
            ? `${plural(group.slides.length, "slide")}, no case number`
            : `${plural(group.slides.length, "slide")} · case number from the folder name`
        }
      />
      {group.slides.map(slideBlock)}
    </span>
  ));
  return (
    <>
      <div className="flex justify-end">{formats}</div>
      <Zone
        title="Slides and their results"
        end={
          <Hint>
            {plural(model.slides.length, "slide")} · {formatBytes(model.bytes)} · {model.matched} of{" "}
            {plural(model.results.length, "result")} matched
          </Hint>
        }
      >
        <div
          data-testid="grouping-line"
          className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-body-sm text-fg-dim"
        >
          <span>
            {ruleText[state.pair]}.{" "}
            {state.cases === "names" ? "Cases from folder names" : "All slides kept loose"}.
          </span>
          <TextLink onClick={() => set({ ruleOpen: !state.ruleOpen })}>
            {state.ruleOpen ? "Done" : "Change"}
          </TextLink>
        </div>
        {state.ruleOpen ? (
          <div
            data-testid="pairing-rule"
            className="grid gap-2.5 rounded-[10px] border border-surf-edge bg-surf-panel px-3.5 py-3 text-body-sm text-fg-dim"
          >
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
              <span className="w-30">Pair results by</span>
              <SegmentedControl
                aria-label="Pair results by"
                value={state.pair}
                onValueChange={(value) => set({ pair: value as PairMode, placed: {} })}
                options={ruleOptions}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
              <span className="w-30">Cases</span>
              <SegmentedControl
                aria-label="Cases"
                value={state.cases}
                onValueChange={(value) => set({ cases: value as LiveState["cases"] })}
                options={[
                  { value: "names", label: "From folder names" },
                  { value: "loose", label: "Keep all loose" },
                ]}
              />
            </div>
          </div>
        ) : null}
        <FileList>
          {model.slides.length === 0 ? (
            <div className="p-3 text-body-sm text-fg-dim">
              No slides in this upload yet. Drop slides below, or go back to the project.
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
          aria-label="Choose a result file"
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
          title="Not matched yet"
          sub="Pick the slide each file goes with. A file with no slide stays out of this upload."
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
          {plural(model.others.length, "file")} {model.others.length === 1 ? "is" : "are"} not{" "}
          {model.others.length === 1 ? "a slide or a result" : "slides or results"} and stay out:{" "}
          {model.others.map((other) => other.path).join(", ")}
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
            Drop more slides, results or folders here
          </span>
          <Pickers take={take} label="Choose files" />
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
}: {
  model: LiveModel<DroppedItem>;
  state: LiveState;
  set: Change;
  projectId: string;
  startError: boolean;
}) {
  const left = model.leftOut.length;
  const lead =
    model.problems > 0
      ? `${plural(model.problems, "file")} need${model.problems === 1 ? "s" : ""} a look. A file with a problem waits until it is fixed, the rest upload.`
      : left > 0
        ? `${plural(left, "result file")} ${left === 1 ? "is" : "are"} left out. The other files are fine and upload.`
        : "Every file is readable and has its place. Nothing needs you.";
  const placedBack = model.results.filter((result) => result.picked);
  return (
    <>
      <Zone title="In this upload" sub={lead} data-testid="check-summary">
        <FactList
          rows={[
            { icon: "slides", label: "Slides", value: String(model.uploadSlides.length) },
            {
              icon: "layers",
              label: "AI results",
              value: left
                ? `${plural(model.uploadResults.length, "file")}, ${left} left out`
                : plural(model.uploadResults.length, "file"),
            },
            {
              icon: "link",
              label: "Matched",
              value: `${model.matched} of ${model.results.length}`,
            },
            {
              icon: "warn",
              label: "To fix",
              value: model.problems ? plural(model.problems, "file") : "Nothing",
            },
            ...(model.others.length > 0
              ? [
                  {
                    icon: "file" as const,
                    label: "Not uploaded",
                    value: `${plural(model.others.length, "file")} that ${model.others.length === 1 ? "is" : "are"} not slides or results`,
                  },
                ]
              : []),
          ]}
        />
      </Zone>
      <Suspense fallback={null}>
        <ServerCheck projectId={projectId} model={model} state={state} startError={startError} />
      </Suspense>
      {model.unplaced.map((result) => (
        <ProblemZone
          key={result.item.path}
          icon="link"
          tag="No slide yet"
          tone="warn"
          title="This result file has no slide yet"
          file={result.item.path}
          text="Nothing next to it or in its name says which slide it belongs to. Pick its slide, or leave it out of this upload."
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
                Leave it out
              </Button>
            </>
          }
        />
      ))}
      {model.empty.map((item) => (
        <ProblemZone
          key={item.path}
          icon="x-circle"
          tag="Empty file"
          tone="bad"
          title="This file has nothing in it"
          file={item.path}
          text="The file is 0 bytes, so there is nothing to read. It waits until you take it out or choose it again."
          actions={
            <Button onClick={() => set({ removed: { ...state.removed, [item.path]: true } })}>
              Remove from this upload
            </Button>
          }
        />
      ))}
      {placedBack.map((result) => (
        <DoneRow
          key={result.item.path}
          file={result.item.path}
          what={`Goes with ${model.slides[result.slide ?? 0]?.path ?? ""}`}
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
          what="Left out of this upload"
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
}: {
  model: LiveModel<DroppedItem>;
  entries: ReturnType<typeof useUploads>["entries"];
}) {
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  const sent = entries.reduce(
    (sum, entry) => sum + (entry.status === "done" ? entry.size : entry.bytesUploaded),
    0,
  );
  const percent = total === 0 ? 0 : Math.min(100, Math.floor((sent / total) * 100));
  const done = entries.filter((entry) => entry.status === "done").length;
  return (
    <>
      <Zone title="Everything" data-testid="upload-overall">
        <ProgressBar
          value={percent}
          tone={done === entries.length && entries.length > 0 ? "ok" : "accent"}
          label={`${done} of ${plural(entries.length, "file")} uploaded`}
          valueText={`${percent}% · ${formatBytes(sent)} of ${formatBytes(total)}`}
        />
      </Zone>
      <Zone
        title="Each file"
        sub={`${plural(model.uploadSlides.length, "slide")} and ${plural(model.uploadResults.length, "result")}`}
      >
        <FileList>
          {entries.map((entry) => {
            const filePercent =
              entry.size === 0
                ? 0
                : entry.status === "done"
                  ? 100
                  : Math.min(100, Math.floor((entry.bytesUploaded / entry.size) * 100));
            return (
              <div
                key={entry.id}
                data-testid="upload-file-row"
                data-status={entry.status}
                className="grid min-h-12 gap-1.5 border-line px-3 py-2 [&+&]:border-t"
              >
                <ProgressBar
                  value={filePercent}
                  tone={
                    entry.status === "done" ? "ok" : entry.status === "failed" ? "bad" : "accent"
                  }
                  label={<span className="font-mono">{entry.name}</span>}
                  valueText={
                    entry.status === "done"
                      ? "Uploaded"
                      : entry.status === "failed"
                        ? "Stopped. What was stored is kept"
                        : entry.status === "retrying"
                          ? "Connection lost. Trying again"
                          : entry.status === "paused"
                            ? `Paused at ${filePercent}%`
                            : `${filePercent}%`
                  }
                />
              </div>
            );
          })}
        </FileList>
      </Zone>
    </>
  );
}
