import {
  useGetCase,
  useListCases,
  useListMySlides,
  useListProjectResultSets,
  useListProjects,
} from "@parfocal/api-client";
import type { MoreItem, SlideRowData } from "@parfocal/ui/components/review-popovers";
import { ReviewProgressPopover, SlidesPopover } from "@parfocal/ui/components/review-popovers";
import type { ReviewMode } from "@parfocal/ui/components/review-top-bar";
import type { ReactNode } from "react";
import { destinations } from "../../shell/destinations.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { formatDue } from "../format.ts";
import { okData } from "../placeholder.tsx";
import { lookUrl } from "../thumbnails.ts";
import type { ReviewSession } from "./review-data.ts";
import type { SlideCounts } from "./review-top.tsx";
import { timeLeft } from "./review-top.tsx";

const seenPercentInPrototype = 38;

export type ReviewTopPopovers = {
  slidesPopover: ReactNode;
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
    void goTo(destinations.slide(projectId, slideId, task?.id));
  };

  const caseSlides: SlideRowData[] = (caseDetail?.slides ?? []).map((slide) => {
    const current = slide.id === session.slideId;
    const queued = inTask.has(slide.id);
    return {
      id: slide.id,
      name: `${slide.label} · ${slide.stain}`,
      thumb,
      resultSets: setsOf(slide.id),
      current,
      status: current
        ? { label: "In review", tone: "accent" }
        : queued
          ? { label: "To review", tone: "neutral" }
          : { label: "Not in task", tone: "neutral" },
      ...(current ? {} : queued ? {} : { sub: "Not part of this task" }),
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
    });
  }
  const inCase = new Set(caseSlides.map((slide) => slide.id));
  const looseSlides: SlideRowData[] = [...inTask]
    .filter((slideId) => !inCase.has(slideId))
    .map((slideId) => {
      const row = mySlides.find((slide) => slide.id === slideId);
      return {
        id: slideId,
        name: row?.label ?? slideId,
        thumb,
        resultSets: setsOf(slideId),
        status: { label: "To review", tone: "neutral" as const },
        sub: "No case attached",
      };
    });

  const caseTitle = session.caseLabel ? `Case ${session.caseLabel}` : undefined;
  const slidesPopover = (
    <SlidesPopover
      caseTitle={caseTitle}
      caseSub={project?.name}
      onOpenCase={projectId ? () => void goTo(destinations.project(projectId)) : undefined}
      caseSlides={caseSlides}
      looseHeading={task ? `Loose slides in task ${task.code}` : undefined}
      looseSlides={looseSlides}
      onPick={pick}
      footer={{
        resultSetsLabel: `Result sets of ${session.slideName.split(" ")[0] ?? ""}`,
        onResultSets: projectId
          ? () => void goTo(destinations.slide(projectId, session.slideId, task?.id))
          : undefined,
        onCompare: () => undefined,
        onAddSlides: projectId ? () => void goTo(destinations.upload(projectId)) : undefined,
      }}
    />
  );

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
            title: "Focus mode is not built yet",
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

  return { slidesPopover, progressPopover, moreItems };
}
