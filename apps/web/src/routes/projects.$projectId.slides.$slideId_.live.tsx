import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import type { CaseLoad } from "../viewer/case-load.ts";
import { loadViewerEngine } from "../viewer/load-engine.ts";
import { SlideStage } from "../viewer/slide-stage.tsx";
import { useCaseLoad } from "../viewer/use-case-load.ts";

const liveSearch = z.object({ task: z.string().optional() });

export const Route = createFileRoute("/projects/$projectId/slides/$slideId_/live")({
  validateSearch: liveSearch,
  loader: loadViewerEngine,
  component: LiveSlide,
});

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
      {load.patient ? (
        <p className="truncate text-body-sm text-fg-dim" data-testid="case-patient">
          Patient {load.patient.name}
          {load.patient.mrn ? ` · MRN ${load.patient.mrn}` : ""}
        </p>
      ) : null}
    </div>
  );
}

function LiveSlide() {
  const { projectId, slideId } = Route.useParams();
  const { task } = Route.useSearch();
  const loaded = useCaseLoad(projectId, slideId, task);
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
      </header>
      <div className="min-h-0 flex-1">
        <SlideStage key={slideId} slideId={slideId} />
      </div>
    </main>
  );
}
