import { createFileRoute, Link } from "@tanstack/react-router";
import { loadViewerEngine } from "../viewer/load-engine.ts";
import { SlideStage } from "../viewer/slide-stage.tsx";

export const Route = createFileRoute("/projects/$projectId/slides/$slideId_/live")({
  loader: loadViewerEngine,
  component: LiveSlide,
});

function LiveSlide() {
  const { projectId, slideId } = Route.useParams();
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
        <h1 className="font-semibold text-body">Slide</h1>
      </header>
      <div className="min-h-0 flex-1">
        <SlideStage key={slideId} slideId={slideId} />
      </div>
    </main>
  );
}
