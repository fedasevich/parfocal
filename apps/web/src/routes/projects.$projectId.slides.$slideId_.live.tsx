import { useGetProject, useGetReviewTask } from "@parfocal/api-client";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { ViewedRing } from "@parfocal/ui/components/viewed-ring";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { z } from "zod";
import { annotateTaskOf } from "../annotations/annotate-task.ts";
import { readBuildConfig } from "../config.ts";
import { ViewingNow } from "../presence/viewing-now.tsx";
import { okData } from "../screens/placeholder.tsx";
import type { CaseLoad } from "../viewer/case-load.ts";
import { loadViewerEngine } from "../viewer/load-engine.ts";
import { CasePatientBanner } from "../viewer/patient-banner-view.tsx";
import { SlideStage } from "../viewer/slide-stage.tsx";
import { useCaseLoad } from "../viewer/use-case-load.ts";
import { useSlideAreas } from "../viewer/use-slide-areas.ts";
import {
  resolveWorkspace,
  type SlideWorkspace,
  workspaceSetups,
  workspaces,
} from "../viewer/workspace.ts";

const liveSearch = z.object({
  task: z.string().optional(),
  workspace: z.enum(workspaces).optional(),
});

export const Route = createFileRoute("/projects/$projectId/slides/$slideId_/live")({
  validateSearch: liveSearch,
  loader: loadViewerEngine,
  component: LiveSlide,
});

const fakeOutlines = readBuildConfig().fakeApi !== "off";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function facts(load: CaseLoad): string[] {
  return [
    load.project.name,
    ...(load.case ? [`Case ${load.case.label}`] : []),
    plural(load.resultSets.length, "result set"),
    ...(load.task ? [`${load.task.code} ${load.task.name}`] : []),
    ...(load.task ? [plural(load.decisions.length, "decision")] : []),
  ];
}

function CaseHeader({ load }: { load: CaseLoad }) {
  return (
    <div className="min-w-0" data-testid="case-header">
      <h1 className="truncate font-semibold text-body">{load.slide?.label ?? "Slide"}</h1>
      <p className="truncate text-body-sm text-fg-dim">{facts(load).join(" · ")}</p>
    </div>
  );
}

function LiveSlide() {
  const { projectId, slideId } = Route.useParams();
  const { task, workspace: chosen } = Route.useSearch();
  const navigate = Route.useNavigate();
  const loaded = useCaseLoad(projectId, slideId, task);
  const [percent, setPercent] = useState<number | null>(null);
  const [peek, setPeek] = useState(false);
  const closePeek = useCallback(() => setPeek(false), []);
  const viewed = { peek, onPeekClose: closePeek, onPercent: setPercent };
  const flagged = loaded.state === "ready" && loaded.load.resultSets.length > 0;
  const slideAreas = useSlideAreas(slideId, flagged);
  const areas = slideAreas.areas;
  const workspace = resolveWorkspace(
    chosen,
    loaded.state === "ready" ? loaded.load.task?.kind : undefined,
  );
  const taskDetail = okData(
    useGetReviewTask(task ?? "", { query: { enabled: task !== undefined } }).data,
  );
  const owner = okData(useGetProject(projectId).data)?.my_role === "owner";
  const annotateTask = annotateTaskOf(taskDetail, slideId, owner);
  const openSlide = (next: string) =>
    void navigate({
      to: "/projects/$projectId/slides/$slideId/live",
      params: { projectId, slideId: next },
      search: { task },
    });
  const switchTo = (next: SlideWorkspace) =>
    void navigate({ search: (previous) => ({ ...previous, workspace: next }), replace: true });
  return (
    <main className="flex h-screen flex-col bg-chrome text-fg">
      <header className="flex items-center gap-3 border-line border-b px-4 py-2">
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="text-accent text-body-sm underline"
        >
          Back to the project
        </Link>
        {loaded.state === "ready" ? (
          <CaseHeader load={loaded.load} />
        ) : (
          <h1 className="font-semibold text-body">Slide</h1>
        )}
        <span className="flex-1" />
        <SegmentedControl
          aria-label="Workspace"
          data-testid="workspace-switch"
          value={workspace}
          onValueChange={(next) => switchTo(next as SlideWorkspace)}
          options={workspaces.map((name) => ({ value: name, label: workspaceSetups[name].label }))}
        />
        <ViewingNow slideId={slideId} />
        {percent === null ? null : (
          <ViewedRing data-testid="viewed-ring" percent={percent} onClick={() => setPeek(true)} />
        )}
      </header>
      {loaded.state === "ready" ? <CasePatientBanner load={loaded.load} /> : null}
      <div className="min-h-0 flex-1">
        <SlideStage
          key={slideId}
          slideId={slideId}
          projectId={projectId}
          {...(task === undefined ? {} : { taskId: task })}
          areas={areas}
          viewed={viewed}
          outlines={fakeOutlines && task !== undefined}
          workspace={workspace}
          annotateTask={annotateTask}
          onOpenSlide={openSlide}
          systematicScan={loaded.state === "ready" && slideAreas.loaded && areas.length === 0}
        />
      </div>
    </main>
  );
}
