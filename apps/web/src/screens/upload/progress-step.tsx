import type { UploadBatch, UploadBatchSlide } from "@parfocal/api-client";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Hint, Zone } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Thumb } from "./parts.tsx";
import {
  joinAnd,
  plural,
  shortName,
  type UploadModel,
  type UploadScene,
  type UploadState,
} from "./state.ts";

type Progress = { percent: number; tone: "ok" | "tiles" | "accent" | "warn"; text: string };

function StepList({
  slide,
  projectId,
  firstSlideId,
}: {
  slide: UploadBatchSlide;
  projectId: string;
  firstSlideId: string | undefined;
}) {
  const waiting = slide.running === null && slide.steps_done < slide.steps.length;
  return (
    <div className="grid gap-1.75 pt-1 pr-3.5 pb-3.5 pl-16.5">
      {slide.steps.map((step, index) => {
        const done = index < slide.steps_done;
        const current = index === slide.steps_done && !waiting && slide.running !== null;
        return (
          <div
            key={step.label}
            className={cn(
              "grid min-h-5.5 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 text-body-sm",
              done || current ? "text-fg" : "text-fg-faint",
            )}
          >
            {done ? (
              <Icon name="check" className="text-ok" />
            ) : current ? (
              <i className="size-3.25 animate-spin justify-self-center rounded-full border-2 border-[color-mix(in_srgb,var(--accent)_25%,transparent)] border-t-accent" />
            ) : (
              <i className="size-3.25 justify-self-center rounded-full border-[1.5px] border-line-strong" />
            )}
            <span>
              {step.label}
              {step.detail && (done || current || step.label.startsWith("No")) ? (
                <small className="ml-2 text-caption text-fg-dim">{step.detail}</small>
              ) : null}
            </span>
            {current && slide.running ? (
              <span className="flex w-57.5 items-center gap-2.5">
                <ProgressBar value={slide.running.percent} className="flex-1" />
                <span className="text-caption whitespace-nowrap text-fg-dim">
                  {slide.running.text}
                </span>
              </span>
            ) : (
              <span />
            )}
          </div>
        );
      })}
      {slide.steps_done >= 3 && firstSlideId ? (
        <div className="pt-1">
          <Button
            size="sm"
            nativeButton={false}
            render={
              <Link
                to="/projects/$projectId/slides/$slideId"
                params={{ projectId, slideId: firstSlideId }}
              />
            }
          >
            {slide.steps_done >= slide.steps.length
              ? "Open the slide"
              : "Open now with what is ready"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ProgressStep({
  batch,
  model,
  state,
  set,
  scene,
  projectId,
  firstSlideId,
}: {
  batch: UploadBatch;
  model: UploadModel;
  state: UploadState;
  set: (change: Partial<UploadState>) => void;
  scene: UploadScene;
  projectId: string;
  firstSlideId: string | undefined;
}) {
  const offline = scene === "sourceoff" && !state.sourceBack;
  const back = scene === "sourceoff" && state.sourceBack;
  const progressOf = (index: number): Progress => {
    const slide = batch.slides[index];
    if (offline && index >= 4) return { percent: 0, tone: "warn", text: "Waiting for the source" };
    if (back && index >= 4) return { percent: 8, tone: "accent", text: "Uploading · 8%" };
    return slide?.progress ?? { percent: 0, tone: "accent", text: "Waiting" };
  };
  const all = model.slides.map(progressOf);
  const ready = all.filter((item) => item.percent === 100).length;
  const waiting = all.filter((item) => item.percent === 0 && item.tone !== "warn").length;
  const source = all.filter((item) => item.tone === "warn").length;
  const running = all.length - ready - waiting - source;
  const tally = [
    ready && `${ready} ready`,
    running && `${running} in progress`,
    waiting && `${waiting} waiting`,
    source && `${source} wait for the source`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <Zone className="gap-3">
        <ProgressBar
          value={46}
          label={
            <b className="font-semibold text-fg">
              {plural(model.slides.length, "slide")} and{" "}
              {plural(model.uploadingResults, "result file")}
            </b>
          }
          valueText="46% · about 3 min left"
        />
        <Hint>
          You can leave this page or close the tab. The upload keeps going on the server and shows
          in the jobs tray at the top.
        </Hint>
      </Zone>
      <Zone title="Files" end={<Hint>{tally}</Hint>}>
        {offline ? (
          <Banner
            tone="warn"
            icon="link"
            inline
            actions={
              <>
                <span className="text-body-sm text-fg-dim">Retrying by itself every 30 s</span>
                <Button size="sm" onClick={() => set({ sourceBack: true })}>
                  Retry now
                </Button>
              </>
            }
          >
            <b>
              {batch.source_outage.source} stopped answering at {batch.source_outage.at}.
            </b>{" "}
            {batch.source_outage.waiting} of {model.slides.length} slides wait. The others keep
            going.
          </Banner>
        ) : null}
        <div className="grid min-w-0 overflow-hidden rounded-[10px] border border-surf-edge bg-surf-panel">
          {model.slides.map((index) => {
            const slide = batch.slides[index];
            if (slide === undefined) return null;
            const progress = progressOf(index);
            const withText = model.withOf(index);
            const open = Boolean(state.openSteps[index]);
            return (
              <div
                key={slide.name}
                data-testid="upload-file-progress"
                className={cn(
                  "border-line [&+&]:border-t",
                  open && "bg-[color-mix(in_srgb,var(--fg)_3%,transparent)]",
                )}
              >
                <div className="grid min-h-14 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3.5 py-1.5 pr-3.5 pl-3">
                  <Thumb />
                  <ProgressBar
                    value={progress.percent}
                    tone={progress.tone}
                    label={
                      <>
                        <b className="font-mono font-medium text-fg">{slide.name}</b>
                        {withText ? (
                          <span className="ml-2 font-mono text-caption text-fg-faint">
                            with {withText}
                          </span>
                        ) : null}
                      </>
                    }
                    valueText={progress.text}
                  />
                  <button
                    type="button"
                    aria-expanded={open}
                    title={`${open ? "Hide" : "Show"} the processing steps`}
                    onClick={() => set({ openSteps: { ...state.openSteps, [index]: !open } })}
                    className="inline-flex h-6.5 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-transparent px-2 text-caption text-fg-dim hover:border-line-strong hover:text-fg"
                  >
                    <span className="font-mono">
                      {Math.min(slide.steps_done, slide.steps.length)} of {slide.steps.length}
                    </span>
                    <Icon name="down" className={cn(open && "rotate-180")} />
                  </button>
                </div>
                {open ? (
                  <StepList slide={slide} projectId={projectId} firstSlideId={firstSlideId} />
                ) : null}
              </div>
            );
          })}
        </div>
      </Zone>
    </>
  );
}

export function DoneStep({
  batch,
  model,
  state,
  set,
  projectId,
  projectCode,
}: {
  batch: UploadBatch;
  model: UploadModel;
  state: UploadState;
  set: (change: Partial<UploadState>) => void;
  projectId: string;
  projectCode: string;
}) {
  const caseSlides = model.inCase.map((index) => shortName(batch.slides[index]?.name ?? ""));
  const loose = model.slides.length - caseSlides.length;
  const caseLabel = batch.slides.find((slide) => slide.case_label)?.case_label ?? "";
  const where = caseSlides.length
    ? `Case ${caseLabel} holds ${joinAnd(caseSlides)}${loose ? `, the other ${plural(loose, "slide is", "slides are")} loose` : ""}.`
    : `${plural(loose, "slide is", "slides are")} loose.`;
  const bare = model.bare.map((index) => batch.slides[index]?.name ?? "");
  const count = bare.length;
  const them = count > 1 ? "them" : "it";
  const total = model.slides.length + model.uploadingResults;
  return (
    <>
      <Zone>
        <div className="mb-1 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
          <Icon name="check" size="md" className="text-ok" />
          <div>
            <h3 className="m-0 text-body font-semibold text-fg">
              {plural(model.slides.length, "slide")} and{" "}
              {plural(model.uploadingResults, "result set")} {total === 1 ? "is" : "are"} in{" "}
              {projectCode}
            </h3>
            <Hint className="mt-1">
              {where}
              {model.slideIn(0) && model.resultIn(0)
                ? ` Every object has an ID, ${batch.done.first_ids} on A1.`
                : " Every object has an ID."}
            </Hint>
          </div>
        </div>
        <ProgressBar
          value={100}
          tone="ok"
          label={`${plural(model.slides.length, "slide")} and ${plural(model.uploadingResults, "result file")}`}
          valueText={`Done in ${batch.done.minutes} min`}
        />
      </Zone>
      {count === 0 ? null : state.leaveBare ? (
        <Zone
          title={`${plural(count, "slide stays", "slides stay")} without results`}
          sub={`Add a result file or run a model on ${them} any time, from the project or from the slide.`}
          end={
            <Button size="sm" variant="ghost" onClick={() => set({ leaveBare: false })}>
              Undo
            </Button>
          }
        />
      ) : (
        <Zone
          highlight
          title={`${plural(count, "slide has", "slides have")} no results`}
          sub={`${joinAnd(bare)} came without AI results. Run a model on ${them} now, or leave ${them} and add results later.`}
          end={<StatusTag tone="accent">Optional</StatusTag>}
          data-testid="no-results-zone"
        >
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button
              nativeButton={false}
              render={<Link to="/projects/$projectId/run-model" params={{ projectId }} />}
            >
              <Icon name="smart" />
              Run a model
            </Button>
            <Button variant="ghost" onClick={() => set({ leaveBare: true })}>
              Leave {them}
            </Button>
          </div>
        </Zone>
      )}
    </>
  );
}
