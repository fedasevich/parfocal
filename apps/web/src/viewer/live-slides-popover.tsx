import { useLingui } from "@lingui/react/macro";
import {
  getGetSlideAiProgressQueryOptions,
  type ReviewTaskDetail,
  useGetCase,
} from "@parfocal/api-client";
import { type SlideRowData, SlidesPopover } from "@parfocal/ui/components/review-popovers";
import { useQueries } from "@tanstack/react-query";
import { okData } from "../screens/placeholder.tsx";
import { slideThumbUrl } from "../screens/slide-thumb-url.ts";
import { destinations } from "../shell/destinations.ts";
import { useGoTo } from "../shell/router-link.tsx";
import type { CaseLoad } from "./case-load.ts";
import { type LiveSlideList, type LiveSlideRow, liveSlideGroups } from "./live-slides.ts";

const scopeHeading = {
  task: "Slides in this task",
  case: "Slides in this case",
  project: "Slides in this project",
} as const;

type LiveSlidesPopoverProps = {
  projectId: string;
  slideId: string;
  slideLabel: string;
  list: LiveSlideList;
  slides: readonly LiveSlideRow[];
  load: CaseLoad | null;
  task: ReviewTaskDetail | undefined;
  onPick: (slideId: string) => void;
  onResultSets: (() => void) | undefined;
};

export function LiveSlidesPopover({
  projectId,
  slideId,
  slideLabel,
  list,
  slides,
  load,
  task,
  onPick,
  onResultSets,
}: LiveSlidesPopoverProps) {
  const { t } = useLingui();
  const goTo = useGoTo();
  const caseId = load?.case?.id ?? "";
  const caseDetail = okData(useGetCase(caseId, { query: { enabled: caseId !== "" } }).data);
  const byId = new Map(slides.map((slide) => [slide.id, slide]));
  const caseSlides =
    load?.case == null
      ? undefined
      : (caseDetail?.slides ??
        load.case.slideIds.map((id) => ({ id, label: byId.get(id)?.label ?? t`Slide` })));
  const groups = liveSlideGroups({
    slideId,
    list,
    slides,
    caseSlides,
    task:
      task === undefined
        ? undefined
        : { id: task.id, slideIds: task.slides.map((slide) => slide.slide_id) },
    currentSetNames: load?.resultSets.map((set) => set.name),
  });
  const building = [...groups.caseRows, ...groups.looseRows]
    .filter((row) => row.building)
    .map((row) => row.id);
  const progress = useQueries({
    queries: building.map((id) => getGetSlideAiProgressQueryOptions(id)),
  });
  const progressOf = (id: string) => {
    const found = okData(progress[building.indexOf(id)]?.data);
    if (found === undefined) return { percent: 0, label: t`Waiting for the AI` };
    const percent =
      found.state === "ready"
        ? 100
        : Math.round(
            found.steps.reduce((sum, step) => sum + step.percent, 0) /
              Math.max(1, found.steps.length),
          );
    return { percent, label: t`The AI is reading` };
  };
  const rowsOf = (rows: typeof groups.caseRows): SlideRowData[] =>
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      thumb: slideThumbUrl(row.id),
      resultSets: row.resultSets,
      current: row.current,
      status: row.status,
      ...(row.building
        ? { progress: progressOf(row.id) }
        : row.sub === undefined
          ? {}
          : { sub: row.sub }),
    }));
  const specimen = caseDetail?.specimens
    .map((item) => [item.type, item.site].filter((word) => word?.trim()).join(", "))
    .find((words) => words !== "");
  const grouped = caseSlides !== undefined && caseSlides.length > 0;
  return (
    <SlidesPopover
      caseTitle={grouped && load?.case ? t`Case ${load.case.label}` : undefined}
      caseSub={[specimen, load?.project.name].filter(Boolean).join(" · ")}
      onOpenCase={() => void goTo(destinations.project(projectId))}
      caseHeading={grouped ? scopeHeading.case : scopeHeading[list.scope]}
      caseSlides={rowsOf(groups.caseRows)}
      looseHeading={task ? t`Loose slides in task ${task.code}` : undefined}
      looseSlides={rowsOf(groups.looseRows)}
      onPick={(id) => {
        if (id !== slideId) onPick(id);
      }}
      footer={{
        resultSetsLabel: t`Result sets of ${slideLabel}`,
        onResultSets,
        compareLabel: t`Compare`,
        onCompare: () =>
          void goTo(destinations.compareSlides(projectId, slideId, task?.id, "picking")),
        compareTitle: t`Open this slide beside another one`,
        onAddSlides: () => void goTo(destinations.upload(projectId)),
        addSlidesTitle: grouped ? t`Add slides to this case` : t`Add slides to this project`,
      }}
    />
  );
}
