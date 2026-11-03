import {
  getGetSlideAiProgressQueryOptions,
  useGetCase,
  useListCases,
  useListMySlides,
  useListProjectResultSets,
  useListProjects,
} from "@parfocal/api-client";
import type { MoreItem, SlideRowData } from "@parfocal/ui/components/review-popovers";
import {
  PinnedSlideStrip,
  ReviewProgressPopover,
  SlidesPopover,
} from "@parfocal/ui/components/review-popovers";
import type { ReviewMode } from "@parfocal/ui/components/review-top-bar";
import { useQueries } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { keyRegistry } from "../../keys/catalogue.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";
import { destinations } from "../../shell/destinations.ts";
import { usePinnedStrip } from "../../shell/pinned-strip.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { formatDue } from "../format.ts";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { lookUrl } from "../thumbnails.ts";
import { caseDetailsOf } from "./case-details.ts";
import type { ReviewSession } from "./review-data.ts";
import type { SlideCounts } from "./review-top.tsx";
import { timeLeft } from "./review-top.tsx";
import { recallSlideCamera, stepSlideId } from "./slide-switch.ts";

const slideStepKeys = ["prevslide", "nextslide"];
const processingStates = new Set(["uploaded", "ai-running"]);
const submittedStates = new Set(["submitted", "disagreement-queue", "signed-off", "exported"]);

const seenPercentInPrototype = 38;

export type ReviewTopPopovers = {
  slidesPopover: ReactNode;
  pinnedStrip: ReactNode;
  progressPopover: ReactNode;
  moreItems: MoreItem[] | undefined;
};

type Options = {
  mode: ReviewMode;
  session: ReviewSession;
  counts: SlideCounts | undefined;
  onWholeSlide?: (() => void) | undefined;
};

export function useReviewTopPopovers({
  mode,
  session,
  counts,
  onWholeSlide,
}: Options): ReviewTopPopovers {
  const goTo = useGoTo();
  const task = session.task;
  const projectId = task?.project_id ?? "";
  const enabled = projectId !== "";
  const project = okData(useListProjects().data)?.find((item) => item.id === projectId);
  const cases = okData(useListCases({ project_id: projectId }, { query: { enabled } }).data);
  const caseId = cases?.find((item) => item.label === session.caseLabel)?.id ?? "";
  const caseDetail = okData(useGetCase(caseId, { query: { enabled: caseId !== "" } }).data);
  const resultSets = okData(useListProjectResultSets(projectId, { query: { enabled } }).data);
  const mySlides =
    okData(useListMySlides({ project_id: projectId }, { query: { enabled } }).data)?.slides ?? [];

  const inTask = new Set((task?.slides ?? []).map((slide) => slide.slide_id));
  const setsOf = (slideId: string) =>
    (resultSets ?? []).filter((set) => set.slide_id === slideId).length;
  const thumb = lookUrl("overview");
  const pick = (slideId: string) => {
    if (!projectId) return;
    void goTo(
      destinations.slide(projectId, slideId, task?.id, undefined, recallSlideCamera(slideId)),
    );
  };
  const blockOf = (blockId: string | null) => {
    if (blockId === null) return undefined;
    for (const specimen of caseDetail?.specimens ?? []) {
      const block = specimen.blocks.find((item) => item.id === blockId);
      if (block) return `${specimen.letter}${block.number}`;
    }
    return undefined;
  };
  const rowOf = (slideId: string) => mySlides.find((slide) => slide.id === slideId);
  const isProcessing = (slideId: string) => processingStates.has(rowOf(slideId)?.status ?? "");

  const processingIds = [...(caseDetail?.slides ?? []).map((slide) => slide.id), ...inTask].filter(
    (slideId, index, all) => isProcessing(slideId) && all.indexOf(slideId) === index,
  );
  const processingPercents = useQueries({
    queries: processingIds.map((slideId) => getGetSlideAiProgressQueryOptions(slideId)),
  });
  const processingOf = (slideId: string) => {
    const at = processingIds.indexOf(slideId);
    const progress = okData(processingPercents[at]?.data);
    if (progress === undefined) return { percent: 0, label: "Waiting for the AI" };
    const percent =
      progress.state === "ready"
        ? 100
        : Math.round(
            progress.steps.reduce((sum, step) => sum + step.percent, 0) /
              Math.max(1, progress.steps.length),
          );
    return { percent, label: "The AI is reading" };
  };

  const statusOf = (slideId: string, current: boolean, queued: boolean): SlideRowData["status"] => {
    if (current) return { label: "In review", tone: "accent" };
    if (isProcessing(slideId)) return { label: "Processing", tone: "neutral" };
    const state = rowOf(slideId)?.reviews.find((review) => review.task_id === task?.id)?.state;
    if (state !== undefined && submittedStates.has(state))
      return { label: "Submitted", tone: "ok" };
    return queued
      ? { label: "To review", tone: "neutral" }
      : { label: "Not in task", tone: "neutral" };
  };
  const progressOf = (slideId: string) =>
    isProcessing(slideId) ? { progress: processingOf(slideId) } : {};
  const decidedText = counts ? `${counts.decided} of ${counts.total} decided` : undefined;

  const caseSlides: SlideRowData[] = (caseDetail?.slides ?? []).map((slide) => {
    const current = slide.id === session.slideId;
    const queued = inTask.has(slide.id);
    const block = blockOf(slide.block_id);
    const detail = current
      ? decidedText
      : queued || isProcessing(slide.id)
        ? undefined
        : "Not part of this task";
    const sub = [block ? `Block ${block}` : undefined, detail].filter(Boolean).join(" · ");
    return {
      id: slide.id,
      name: `${slide.label} · ${slide.stain}`,
      thumb,
      resultSets: setsOf(slide.id),
      current,
      status: statusOf(slide.id, current, queued),
      ...(sub ? { sub } : {}),
      ...progressOf(slide.id),
    };
  });
  if (caseSlides.length === 0 && session.slideName) {
    caseSlides.push({
      id: session.slideId,
      name: session.slideName,
      thumb,
      resultSets: setsOf(session.slideId),
      current: true,
      status: { label: "In review", tone: "accent" },
      ...(decidedText ? { sub: decidedText } : {}),
    });
  }
  const inCase = new Set(caseSlides.map((slide) => slide.id));
  const looseSlides: SlideRowData[] = [...inTask]
    .filter((slideId) => !inCase.has(slideId))
    .map((slideId) => {
      const row = rowOf(slideId);
      return {
        id: slideId,
        name: row?.label ?? slideId,
        thumb,
        resultSets: setsOf(slideId),
        status: statusOf(slideId, false, true),
        sub: "No case attached",
        ...progressOf(slideId),
      };
    });

  const stepBindings = useMemo(
    () => keyRegistry.bindings({ scopes: ["viewer"], only: slideStepKeys }),
    [],
  );
  const stepIds =
    (caseDetail?.slides.length ?? 0) > 0
      ? [...caseSlides, ...looseSlides].map((slide) => slide.id)
      : [...inTask];
  useHotkeys(stepBindings, ({ action }) => {
    if (mode === "guided") return;
    const target = stepSlideId(stepIds, session.slideId, action === "nextslide" ? 1 : -1);
    if (target !== undefined) pick(target);
  });

  const caseTitle = session.caseLabel ? `Case ${session.caseLabel}` : undefined;
  const person = usePeople();
  const details = caseDetailsOf({
    projectName: project?.name,
    clinical: project?.privacy_mode === "clinical",
    caseLabel: session.caseLabel ?? undefined,
    specimens: caseDetail?.specimens,
    taskTitle: task ? `${task.code} · ${task.name}` : undefined,
    researcher: person(task?.created_by_user_id)?.name,
  });
  const compareStub = "Opens the compare view. Picking the exact slide arrives with side by side.";
  const compareTo = (scene: "picking" | "picked") => {
    if (!projectId) return undefined;
    return () => void goTo(destinations.compareSlides(projectId, session.slideId, task?.id, scene));
  };
  const openSideBySide = compareTo("picked");
  const slidesPopover = (
    <SlidesPopover
      caseTitle={caseTitle}
      caseSub={project?.name}
      onOpenCase={projectId ? () => void goTo(destinations.project(projectId)) : undefined}
      details={details}
      caseSlides={caseSlides}
      looseHeading={task ? `Loose slides in task ${task.code}` : undefined}
      looseSlides={looseSlides}
      onPick={pick}
      onSideBySide={openSideBySide ? () => openSideBySide() : undefined}
      sideBySideTitle={compareStub}
      footer={{
        resultSetsLabel: `Result sets of ${session.slideName.split(" ")[0] ?? ""}`,
        onResultSets: projectId
          ? () => void goTo(destinations.slide(projectId, session.slideId, task?.id))
          : undefined,
        onCompare: compareTo("picking"),
        compareTitle: compareStub,
        onAddSlides: projectId ? () => void goTo(destinations.upload(projectId)) : undefined,
        addSlidesTitle: "Add slides to this case",
      }}
    />
  );

  const [stripPinned] = usePinnedStrip();
  const stripSlides = [...caseSlides, ...looseSlides];
  const pinnedStrip =
    stripPinned && mode !== "guided" && stripSlides.length > 1 ? (
      <PinnedSlideStrip slides={stripSlides} onPick={pick} />
    ) : null;

  const neighbours = session.neighbours;
  const progressPopover =
    task && neighbours && counts ? (
      <ReviewProgressPopover
        taskCode={task.code}
        taskName={task.name}
        taskSub={project?.name ?? ""}
        slideName={session.slideName}
        slide={counts}
        seenPercent={seenPercentInPrototype}
        onWholeSlide={onWholeSlide}
        wholeSlideTitle={onWholeSlide ? undefined : "Shows the whole slide in the next update"}
        position={neighbours.position}
        slideTotal={neighbours.total}
        submittedCount={neighbours.position - 1}
        dueText={task.due_on ? formatDue(task.due_on) : "No due date"}
        timeLeft={timeLeft(session).replace(/ left$/, "")}
        guided={mode === "guided"}
        onPrevious={
          neighbours.previous
            ? () =>
                void goTo(
                  mode === "guided"
                    ? destinations.guided(task.id, neighbours.previous?.id)
                    : destinations.slide(projectId, neighbours.previous?.id ?? "", task.id),
                )
            : undefined
        }
        onNext={
          neighbours.next
            ? () => void goTo(destinations.slide(projectId, neighbours.next?.id ?? "", task.id))
            : undefined
        }
      />
    ) : undefined;

  const moreItems: MoreItem[] | undefined =
    mode === "annotate"
      ? [
          { icon: "share", label: "Share this view", title: "Sharing a view is not built yet" },
          {
            icon: "comment",
            label: "Ask for a second opinion",
            onSelect: () => task && void goTo(`/tasks/${task.id}/comments`),
          },
          {
            icon: "upload",
            label: "Add slides to this case",
            onSelect: () => projectId && void goTo(destinations.upload(projectId)),
          },
          {
            icon: "expand",
            label: "Focus mode",
            keys: "⌘\\",
            onSelect: () =>
              projectId && void goTo(destinations.focus(projectId, session.slideId, task?.id)),
            separatorBefore: true,
          },
          {
            icon: "help",
            label: "Keyboard shortcuts",
            keys: "?",
            onSelect: () => void goTo(destinations.settings("shortcuts")),
          },
          {
            icon: "gear",
            label: "Settings",
            keys: "⌘,",
            onSelect: () => void goTo(destinations.settings("display")),
          },
        ]
      : undefined;

  return { slidesPopover, pinnedStrip, progressPopover, moreItems };
}
