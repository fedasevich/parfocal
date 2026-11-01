import type { UploadBatch, UploadProblem } from "@parfocal/api-client";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { FactList } from "@parfocal/ui/components/inspector";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Hint, Zone } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SlidePicker } from "./files-step.tsx";
import { SlideOverlay } from "./parts.tsx";
import { gb, plural, type UploadModel, type UploadScene, type UploadState } from "./state.ts";

const problemLook: Record<
  UploadProblem["kind"],
  { icon: IconName; tag: string; tone: "bad" | "warn" }
> = {
  "read-error": { icon: "x-circle", tag: "Read error", tone: "bad" },
  scale: { icon: "expand", tag: "Does not line up", tone: "warn" },
  "new-classes": { icon: "flag", tag: "New classes", tone: "warn" },
};

const classColours: Record<string, string> = {
  Tumor: "var(--c-tumor)",
  Stroma: "var(--c-stroma)",
  Immune: "var(--c-immune)",
  Other: "var(--c-other)",
};

function ProblemZone({
  icon,
  tag,
  tone,
  title,
  file,
  text,
  evidence,
  extra,
  actions,
}: {
  icon: IconName;
  tag: string;
  tone: "bad" | "warn";
  title: string;
  file: string;
  text: string;
  evidence?: ReactNode;
  extra?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <Zone className="gap-3.5" data-testid="upload-problem">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5">
        <Icon name={icon} className={cn("mt-1", tone === "bad" ? "text-bad" : "text-warn")} />
        <div className="grid min-w-0 gap-0.5">
          <h3 className="m-0 text-title-sm leading-[1.3] font-semibold text-fg">{title}</h3>
          <span className="block font-mono text-body-sm text-fg-dim">{file}</span>
        </div>
        <StatusTag tone={tone}>{tag}</StatusTag>
      </div>
      <Hint>{text}</Hint>
      {evidence ? <div className="border-y border-line">{evidence}</div> : null}
      {extra}
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </Zone>
  );
}

function DoneRow({
  file,
  what,
  out,
  onUndo,
}: {
  file: string;
  what: string;
  out?: boolean;
  onUndo: () => void;
}) {
  return (
    <Zone
      className="grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"
      data-testid="upload-fixed"
    >
      <Icon name={out ? "minus-circle" : "check"} className={out ? "text-fg-dim" : "text-ok"} />
      <span className="grid min-w-0 gap-0.5">
        <b className="truncate font-mono text-body-sm font-medium text-fg">{file}</b>
        <small className="text-body-sm text-fg-dim">{what}</small>
      </span>
      <Button size="sm" variant="ghost" onClick={onUndo}>
        Undo
      </Button>
    </Zone>
  );
}

export function CheckStep({
  batch,
  model,
  state,
  set,
  scene,
  projectId,
  projectCode,
  toast,
}: {
  batch: UploadBatch;
  model: UploadModel;
  state: UploadState;
  set: (change: Partial<UploadState>) => void;
  scene: UploadScene;
  projectId: string;
  projectCode: string;
  toast: (message: ReactNode) => void;
}) {
  const open = model.openIn(scene);
  const full = scene === "storagefull" && !state.trimmed;
  const unmatchedScene = scene === "unmatched";
  const left = unmatchedScene ? (state.unmatchedOut ? 1 : 0) : model.leftCount;
  const others = model.files - open;
  const lead =
    scene === "storagefull"
      ? "Every file reads cleanly. Only the space is short, and nothing uploads until it fits."
      : open
        ? `${open} file${open > 1 ? "s need" : " needs"} a look. The other ${plural(others, "file")} ${others === 1 ? "is" : "are"} fine. A file with a problem waits until it is fixed, the rest upload.`
        : left
          ? `${left} file${left > 1 ? "s are" : " is"} left out. The other ${plural(model.files - left, "file")} read cleanly and upload.`
          : "Every file reads cleanly and lines up with its slide. Nothing needs you.";
  const loose = model.slides.length - model.inCase.length;
  const rows = [
    {
      icon: "slides" as const,
      label: "Slides",
      value:
        scene === "storagefull" && state.trimmed
          ? `${batch.storage.trimmed_slides} · ${gb(batch.storage.trimmed_gb)}, ${model.slides.length - batch.storage.trimmed_slides} left out`
          : `${model.slides.length} · ${gb(model.sizeGb)}`,
    },
    {
      icon: "layers" as const,
      label: "AI results",
      value: left
        ? `${plural(model.resultCount - left, "file")}, ${left} left out`
        : plural(model.resultCount, "file"),
    },
    { icon: "link" as const, label: "Matched", value: `${model.matched} of ${model.resultCount}` },
    {
      icon: "folder" as const,
      label: "Cases",
      value:
        state.cases === "names" && model.inCase.length > 0
          ? `1 case, ${loose} loose`
          : plural(model.slides.length, "loose slide"),
    },
    ...(scene === "storagefull"
      ? [
          {
            icon: "database" as const,
            label: "Space",
            value: full
              ? `${batch.storage.needed_gb} GB needed, ${batch.storage.left_gb} GB left in ${projectCode}`
              : `${batch.storage.trimmed_gb} GB needed, ${batch.storage.left_gb} GB left in ${projectCode}`,
          },
        ]
      : []),
    {
      icon: "warn" as const,
      label: "To fix",
      value: open ? `${open} file${open > 1 ? "s" : ""}` : "Nothing",
    },
  ];
  const heatmap = batch.results[2];
  const problems = batch.problems.map((problem, index) => {
    const look = problemLook[problem.kind];
    const result = batch.results[problem.result];
    const file = result?.name ?? "";
    if (index === 1 && model.resultTo(2).slide === null) {
      if (state.unmatchedOut) {
        return (
          <DoneRow
            key={file}
            file={file}
            what="Left out of this upload"
            out
            onUndo={() => set({ unmatchedOut: false })}
          />
        );
      }
      return (
        <ProblemZone
          key={file}
          icon="link"
          tag="No slide yet"
          tone="warn"
          title="This heatmap has no slide yet"
          file={file}
          text="It sat in results/ and a PNG has no slide ID inside. Pick its slide and Parfocal checks how it lines up."
          actions={
            <>
              <SlidePicker
                batch={batch}
                slides={model.slides}
                size="default"
                onPick={(slide) => set({ placed: { ...state.placed, 2: slide } })}
              />
              <Button variant="ghost" onClick={() => set({ unmatchedOut: true })}>
                Leave it out
              </Button>
            </>
          }
        />
      );
    }
    if (unmatchedScene) {
      return index === 1 ? (
        <DoneRow
          key={file}
          file={heatmap?.name ?? file}
          what={`Goes with ${batch.slides[model.resultTo(2).slide ?? 2]?.name ?? ""}, placed at level 2, scaled ×4`}
          onUndo={() => {
            const placed = { ...state.placed };
            delete placed[2];
            set({ placed });
          }}
        />
      ) : null;
    }
    if (state.fixed[index]) {
      return (
        <DoneRow
          key={file}
          file={file}
          what={problem.fixed}
          onUndo={() => set({ fixed: { ...state.fixed, [index]: false } })}
        />
      );
    }
    if (!model.problemIn(index)) return null;
    if (state.left[index]) {
      return (
        <DoneRow
          key={file}
          file={file}
          what="Left out of this upload"
          out
          onUndo={() => set({ left: { ...state.left, [index]: false } })}
        />
      );
    }
    const fix = () => set({ fixed: { ...state.fixed, [index]: true } });
    const evidence =
      problem.kind === "read-error" ? (
        <div className="grid">
          {problem.lines.map((line) => (
            <div
              key={line.line}
              className="grid grid-cols-[92px_92px_1fr] gap-2.5 border-line py-2.25 font-mono text-caption text-fg-dim [&+&]:border-t"
            >
              <span>line {line.line}</span>
              <span>object {line.object}</span>
              <b className="font-medium text-bad">{line.error}</b>
            </div>
          ))}
        </div>
      ) : problem.kind === "scale" ? (
        <div className="flex gap-4 py-3.5">
          <figure className="m-0 grid justify-items-start gap-2 text-caption text-fg-dim">
            <SlideOverlay kind="off" height={128} />
            <figcaption>Level 0 · 4% on tissue</figcaption>
          </figure>
          <figure className="m-0 grid justify-items-start gap-2 text-caption">
            <span className="rounded-md outline-2 outline-offset-1 outline-accent">
              <SlideOverlay kind="heat" height={128} />
            </span>
            <figcaption className="font-medium text-fg">Level 2, ×4 · 97% on tissue</figcaption>
          </figure>
        </div>
      ) : (
        <div className="grid">
          <div className="grid min-h-8 grid-cols-[minmax(0,1fr)_56px_16px_minmax(0,1.1fr)] items-center gap-2.5 border-b border-line-strong text-caption font-semibold text-fg-dim">
            <span>In the file</span>
            <span>Cells</span>
            <span />
            <span>Class in {projectCode}</span>
          </div>
          {batch.new_classes.map((item) => (
            <div
              key={item.name}
              className="grid min-h-11.5 grid-cols-[minmax(0,1fr)_56px_16px_minmax(0,1.1fr)] items-center gap-2.5 border-line text-body-sm [&+&]:border-t"
            >
              <b className="font-mono font-medium">{item.name}</b>
              <span className="font-mono text-fg-dim">{item.cells.toLocaleString("en-US")}</span>
              <Icon name="next" className="text-fg-faint" />
              <Select defaultValue={item.to ?? undefined}>
                <SelectTrigger size="sm" aria-label={`Class for ${item.name}`} className="w-full">
                  <SelectValue placeholder="Choose a class" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(classColours).map(([name, colour]) => (
                    <SelectItem key={name} value={name}>
                      <span className="inline-flex items-center gap-2">
                        <span className="size-2.5 rounded-[3px]" style={{ background: colour }} />
                        {name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      );
    return (
      <ProblemZone
        key={file}
        icon={look.icon}
        tag={look.tag}
        tone={look.tone}
        title={problem.title}
        file={file}
        text={problem.text}
        evidence={evidence}
        extra={
          problem.kind === "new-classes" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-body-sm text-fg-dim">
              <span>{batch.unscored_rows} rows have no score</span>
              <SegmentedControl
                aria-label="Rows with no score"
                defaultValue="keep"
                options={[
                  { value: "keep", label: "Keep with no score" },
                  { value: "one", label: "Count as 1.0" },
                ]}
              />
            </div>
          ) : null
        }
        actions={
          <>
            <Button onClick={fix}>{problem.fix}</Button>
            {problem.kind === "read-error" ? (
              <>
                <Button onClick={() => toast("Downloads the error report as a CSV (mock)")}>
                  <Icon name="download" />
                  Error report
                </Button>
                <Button
                  variant="ghost"
                  nativeButton={false}
                  render={
                    <Link
                      to="/projects/$projectId/upload"
                      params={{ projectId }}
                      search={{ scene: "check", formats: "help" }}
                    />
                  }
                >
                  What files work?
                </Button>
              </>
            ) : null}
          </>
        }
      />
    );
  });
  return (
    <>
      {full ? (
        <Banner
          tone="warn"
          inline
          actions={
            <>
              <Link to="/admin" className="text-body-sm font-medium text-accent hover:underline">
                Storage and sources
              </Link>
              <Button size="sm" onClick={() => set({ trimmed: true })}>
                Remove the 4 largest slides from this upload
              </Button>
            </>
          }
        >
          <b>Not enough space.</b> This upload needs {batch.storage.needed_gb} GB and {projectCode}{" "}
          has {batch.storage.left_gb} GB left of its {batch.storage.allowance_gb} GB allowance.
        </Banner>
      ) : null}
      <Zone title="In this upload" sub={lead}>
        <FactList rows={rows} />
      </Zone>
      {problems}
    </>
  );
}
