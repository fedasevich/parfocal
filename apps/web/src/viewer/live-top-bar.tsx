import { Trans, useLingui } from "@lingui/react/macro";
import {
  type ReviewTaskDetail,
  useGetMe,
  useGetSlideNeighbours,
  useListMySlides,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@parfocal/ui/components/popover";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { ViewingNow } from "../presence/viewing-now.tsx";
import { formatDue } from "../screens/format.ts";
import { okData } from "../screens/placeholder.tsx";
import { useReviewSession } from "../screens/review/review-data.ts";
import { slideThumbUrl } from "../screens/slide-thumb-url.ts";
import { AccountMenu } from "../shell/account-menu.tsx";
import { personOf } from "../shell/global-shell.tsx";
import type { CaseLoad } from "./case-load.ts";
import { LiveProgress, useSlideStepKeys } from "./live-progress.tsx";
import { type LiveReview, liveReview } from "./live-review.ts";
import { type LiveSlideList, liveSlideList, withNeighbours } from "./live-slides.ts";
import { LiveSlidesPopover } from "./live-slides-popover.tsx";
import type { ReturnKind } from "./return-page.ts";
import { SlideExportMenu } from "./slide-export-menu.tsx";
import { useReturnPage } from "./use-return-page.ts";
import type { ModeChoice } from "./viewer-mode.ts";

const slidePage = 200;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function facts(load: CaseLoad, task: ReviewTaskDetail | undefined): string[] {
  if (load.task) {
    return [load.project.name, ...(task?.due_on ? [`due ${formatDue(task.due_on)}`] : [])];
  }
  return [
    ...(load.case ? [`Case ${load.case.label}`] : []),
    plural(load.resultSets.length, "result set"),
  ];
}

function GuidedSlideChip({
  slideId,
  label,
  position,
  total,
}: {
  slideId: string;
  label: string;
  position: number | undefined;
  total: number | undefined;
}) {
  const { t } = useLingui();
  return (
    <span
      data-testid="guided-slide-chip"
      title={
        position === undefined || total === undefined
          ? t`Submit opens the next slide`
          : t`Slide ${position} of ${total}. Submit opens the next one`
      }
      className="inline-flex h-10 shrink-0 items-center gap-2.5 rounded-ctl border border-line bg-transparent pr-3 pl-1.5 text-fg"
    >
      <span
        aria-hidden="true"
        data-slot="slide-thumb"
        className="h-6.5 w-9 shrink-0 rounded-[4px] bg-[#f1eef2] bg-cover bg-center"
        style={{ backgroundImage: `url(${slideThumbUrl(slideId)})` }}
      />
      <b className="max-w-56 truncate text-body-sm font-semibold" data-phi="">
        {label}
      </b>
    </span>
  );
}

function SlidePicker({
  list,
  slideId,
  label,
  children,
}: {
  list: LiveSlideList;
  slideId: string;
  label: string;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-testid="slide-picker"
        aria-haspopup="dialog"
        title={t`Slides in this ${list.scope}`}
        className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-2.5 rounded-ctl border border-line-strong bg-btn-bg pr-2.5 pl-1.5 text-fg outline-none hover:border-fg-faint focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent aria-expanded:border-fg-faint"
      >
        <span
          aria-hidden="true"
          data-slot="slide-thumb"
          className="h-5.5 w-7.5 shrink-0 rounded-[4px] bg-[#f1eef2] bg-cover bg-center"
          style={{ backgroundImage: `url(${slideThumbUrl(slideId)})` }}
        />
        <b className="max-w-56 truncate text-body-sm font-semibold" data-phi="">
          {label}
        </b>
        <Icon name="down" className="text-fg-faint" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-0"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button")) setOpen(false);
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

type LiveTopBarProps = {
  projectId: string;
  slideId: string;
  load: CaseLoad | null;
  task: ReviewTaskDetail | undefined;
  choice: ModeChoice;
  choices: readonly ModeChoice[];
  guided?: boolean;
  onMode: (next: ModeChoice) => void;
  onOpenSlide: (slideId: string) => void;
  onSubmit: (() => void) | undefined;
  onResultSets?: (() => void) | undefined;
  onCompare?: (() => void) | undefined;
  percent: number | null;
  progressNote?: string | undefined;
  objectTotal: number;
  onPeek: () => void;
  statusRef: (node: HTMLElement | null) => void;
  finishRef?: ((node: HTMLElement | null) => void) | undefined;
  storage: ReactNode;
};

function ReviewTopBar({ taskId, ...props }: LiveTopBarProps & { taskId: string }) {
  const review = liveReview(useReviewSession(taskId, props.slideId));
  return <TopBar {...props} review={review} />;
}

export function LiveTopBar(props: LiveTopBarProps) {
  return props.task?.kind === "review" ? (
    <ReviewTopBar {...props} taskId={props.task.id} />
  ) : (
    <TopBar {...props} review={undefined} />
  );
}

function TopBar({
  projectId,
  slideId,
  load,
  task,
  choice,
  choices,
  guided = false,
  onMode,
  onOpenSlide,
  onSubmit,
  onResultSets,
  onCompare,
  percent,
  progressNote,
  objectTotal,
  onPeek,
  statusRef,
  finishRef,
  storage,
  review,
}: LiveTopBarProps & { review: LiveReview | undefined }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const choiceLabels: Record<ModeChoice, string> = {
    look: t`Look`,
    review: t`Review`,
    guided: t`Guided`,
    annotate: t`Annotate`,
  };
  const me = okData(useGetMe().data);
  const projectSlides =
    okData(useListMySlides({ project_id: projectId, limit: slidePage }).data)?.slides ?? [];
  const neighbours = okData(
    useGetSlideNeighbours(
      slideId,
      task === undefined
        ? { from: "all-slides", project_id: projectId }
        : { from: "task", task_id: task.id },
    ).data,
  );
  const list = withNeighbours(
    liveSlideList({
      slideId,
      slides: projectSlides,
      taskSlideIds: task?.slides.map((slide) => slide.slide_id),
      caseSlideIds: load?.case?.slideIds,
    }),
    neighbours,
  );
  const reviewTask = task?.kind === "review";
  const title = load?.task?.name ?? load?.project.name ?? "";
  const slideLabel = review?.slideName || (load?.slide?.label ?? t`Slide`);
  const reportCaseId = load?.clinical ? load.case?.id : undefined;
  const back = useReturnPage();
  const backLabels: Record<ReturnKind, string> = {
    "my-work": t`My work`,
    project: t`Project`,
    disagreements: t`Disagreements`,
    adjudication: t`Adjudication`,
    evaluation: t`Evaluation`,
    "sign-off": t`Sign-off`,
    "task-comments": t`Comments`,
    search: t`Search`,
    notifications: t`Notifications`,
    home: t`Home`,
  };
  const backLabel = backLabels[back.kind];
  useSlideStepKeys(list, slideId, onOpenSlide);
  return (
    <header
      data-testid="live-top-bar"
      data-guided={guided || undefined}
      className={`flex shrink-0 items-center gap-3 border-line border-b bg-chrome px-3 text-body-sm ${guided ? "h-16" : "h-11"}`}
    >
      <a
        href={back.href}
        data-testid="viewer-back"
        data-return={back.kind}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          void navigate({ href: back.href });
        }}
        title={t`Back to ${backLabel}. Every answer is saved`}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-ctl px-2 font-medium ${guided ? "h-10" : "h-8"} text-fg-dim no-underline hover:text-fg`}
      >
        <Icon name="back" />
        <span>{backLabel}</span>
      </a>
      <span aria-hidden="true" className="h-6 w-px shrink-0 bg-line" />
      <div data-testid="case-header" data-phi="" className="flex min-w-0 items-center gap-3">
        <div className="grid min-w-0 leading-tight">
          <b
            className="truncate font-semibold"
            title={load?.task ? `${load.task.code} · ${load.task.name}` : undefined}
          >
            {title}
          </b>
          <small className="truncate text-caption text-fg-dim">
            {load ? facts(load, task).join(" · ") : ""}
          </small>
        </div>
        {guided ? (
          <GuidedSlideChip
            slideId={slideId}
            label={slideLabel}
            position={neighbours?.position}
            total={neighbours?.total}
          />
        ) : (
          <SlidePicker list={list} slideId={slideId} label={slideLabel}>
            <LiveSlidesPopover
              projectId={projectId}
              slideId={slideId}
              slideLabel={load?.slide?.label ?? slideLabel}
              list={list}
              slides={projectSlides}
              load={load}
              task={task}
              onPick={onOpenSlide}
              onResultSets={onResultSets}
              onCompare={onCompare}
            />
          </SlidePicker>
        )}
      </div>
      <span
        data-testid="slide-progress"
        className="inline-flex shrink-0 items-center gap-2.5"
        title={t`Progress on this slide and in the list`}
      >
        <LiveProgress
          list={list}
          slideId={slideId}
          slideLabel={slideLabel}
          load={load}
          task={task}
          review={review}
          percent={percent}
          note={progressNote}
          objectTotal={objectTotal}
          onPeek={onPeek}
          onOpenSlide={onOpenSlide}
        />
      </span>
      {storage}
      <span className="flex-1" />
      <span ref={statusRef} data-slot="live-save-status" className="min-w-0" />
      {task !== undefined && !reviewTask ? (
        <SlideExportMenu slideId={slideId} taskId={task.id} />
      ) : null}
      {choices.length < 2 ? null : (
        <SegmentedControl
          aria-label={t`Mode`}
          data-testid="mode-switch"
          className="shrink-0"
          {...(guided ? { size: "lg" as const } : {})}
          value={choice}
          onValueChange={(next: string) => {
            const picked = choices.find((value) => value === next);
            if (picked !== undefined) onMode(picked);
          }}
          options={choices.map((value) => ({ value, label: choiceLabels[value] }))}
        />
      )}
      {reportCaseId !== undefined ? (
        <Button
          variant={onSubmit && reviewTask ? "secondary" : "primary"}
          title={t`Open the clinical report of this case`}
          onClick={() =>
            void navigate({
              to: "/projects/$projectId/cases/$caseId/report",
              params: { projectId, caseId: reportCaseId },
            })
          }
        >
          <Trans>Open report</Trans>
        </Button>
      ) : null}
      {onSubmit && reviewTask ? (
        <Button
          variant="primary"
          data-testid="top-submit"
          {...(guided ? { size: "lg" as const } : {})}
          disabled={review === undefined || review.submitReason !== undefined}
          title={
            review === undefined
              ? t`Opening the objects of this slide`
              : (review.submitReason ?? t`Send your decisions and answers on this slide`)
          }
          onClick={onSubmit}
        >
          <Trans>Submit</Trans>
        </Button>
      ) : null}
      {task !== undefined && !reviewTask && finishRef !== undefined ? (
        <span ref={finishRef} data-slot="top-finish" className="flex shrink-0 empty:hidden" />
      ) : null}
      <ViewingNow slideId={slideId} taskId={task?.id} />
      <AccountMenu me={me} person={personOf(me)} home />
    </header>
  );
}
