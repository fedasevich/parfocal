import { createFileRoute } from "@tanstack/react-router";
import { GuidedGate } from "../screens/review/guided-gate.tsx";
import { FullViewer } from "../screens/viewer/full-viewer.tsx";
import { type SlideSearch, slideSearch } from "../search/route-searches.ts";
import { slidePath } from "../shell/slide-link.ts";
import { EngineViewer } from "../viewer/engine-viewer.tsx";
import { openSlideEarly } from "../viewer/load-engine.ts";
import { slideRedirect } from "../viewer/old-slide-address.ts";
import type { StageStart } from "../viewer/stage-start.tsx";
import { TaskSlideCheck } from "../viewer/task-slide-check.tsx";
import { layoutOfOldAddress } from "../viewer/viewer-layout.ts";
import { modeOfWorkspace } from "../viewer/viewer-mode.ts";

export const Route = createFileRoute("/projects/$projectId/slides/$slideId")({
  validateSearch: slideSearch,
  beforeLoad: ({ params, search, location }) => {
    const oldLayout = layoutOfOldAddress(location.search);
    if (search.workspace === undefined && oldLayout === null) return;
    throw slideRedirect(params, location.search, {
      ...oldLayout,
      workspace: undefined,
      mode:
        search.workspace === undefined
          ? search.mode
          : (search.mode ?? modeOfWorkspace(search.workspace, search.task !== undefined)),
    });
  },
  loader: ({ params, cause }) => openSlideEarly(params.slideId, cause),
  component: SlideView,
});

function SlideView() {
  const { projectId, slideId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSearch = (change: Partial<SlideSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...change }), replace: true });
  if (search.scene !== undefined) {
    return (
      <FullViewer
        projectId={projectId}
        slideId={slideId}
        search={{ ...search, tool: search.tool === "smart" ? undefined : search.tool }}
        onSearch={onSearch}
      />
    );
  }
  const viewer = (
    <EngineViewer
      projectId={projectId}
      slideId={slideId}
      task={search.task}
      mode={search.mode}
      tab={search.tab}
      object={search.object}
      start={startOf(search)}
      tool={search.tool}
      layout={search.layout}
      withSlideId={search.with}
      onLayout={(change) => {
        const search = { layout: change.layout, with: change.withSlideId, peek: undefined };
        if (change.slideId === undefined || change.slideId === slideId) onSearch(search);
        else
          void navigate({
            to: slidePath,
            params: { projectId, slideId: change.slideId },
            search: (previous) => ({ ...previous, ...search }),
          });
      }}
      onOpenSlide={(next) =>
        void navigate({
          to: slidePath,
          params: { projectId, slideId: next },
          search: {
            task: search.task,
            mode: search.mode,
            tab: search.tab,
            layout: search.layout === "focus" ? "focus" : undefined,
          },
        })
      }
      onMode={(mode) => onSearch({ mode })}
      onModeCorrect={(mode) => onSearch({ mode })}
      onTab={(tab) => onSearch({ tab })}
    />
  );
  return (
    <TaskSlideCheck projectId={projectId} taskId={search.task} slideId={slideId}>
      {search.task === undefined || search.mode !== "guided" ? (
        viewer
      ) : (
        <GuidedGate taskId={search.task} slideId={slideId}>
          {() => viewer}
        </GuidedGate>
      )}
    </TaskSlideCheck>
  );
}

function startOf(search: SlideSearch): StageStart | undefined {
  if (search.x === undefined || search.y === undefined) return undefined;
  return { x: search.x, y: search.y, scale: search.z ?? 1 };
}
