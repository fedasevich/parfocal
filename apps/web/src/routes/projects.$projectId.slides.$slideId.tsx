import { createFileRoute } from "@tanstack/react-router";
import { FullViewer } from "../screens/viewer/full-viewer.tsx";
import { isCompareScene } from "../screens/viewer/viewer-scenes.ts";
import { CompareView } from "../screens/viewer-tools/compare-view.tsx";
import { FocusView } from "../screens/viewer-tools/focus-view.tsx";
import { WithToolSession } from "../screens/viewer-tools/tool-session.tsx";
import { type SlideSearch, slideSearch } from "../search/route-searches.ts";
import { EngineViewer } from "../viewer/engine-viewer.tsx";
import { FirstReadGuard } from "../viewer/first-read-guard.tsx";
import { loadViewerEngine } from "../viewer/load-engine.ts";
import type { StageStart } from "../viewer/stage-start.tsx";

export const Route = createFileRoute("/projects/$projectId/slides/$slideId")({
  validateSearch: slideSearch,
  loader: loadViewerEngine,
  component: SlideView,
});

function SlideView() {
  const { projectId, slideId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSearch = (change: Partial<SlideSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...change }), replace: true });
  if (search.focus || isCompareScene(search.scene)) {
    const scene = search.scene;
    return (
      <WithToolSession projectId={projectId} slideId={slideId} task={search.task}>
        {(tools) =>
          search.focus ? (
            <FocusView
              tools={tools}
              object={search.object}
              onShowUi={() => onSearch({ focus: undefined, peek: undefined, scene: "objects" })}
              onObject={(next) => onSearch({ object: next })}
              peekOpen={search.peek === true}
              onPeekChange={(open) => onSearch({ peek: open || undefined })}
            />
          ) : (
            <CompareView
              key={scene}
              tools={tools}
              scene={scene === "picking" ? "picking" : "picked"}
              rightSlideId={search.with}
              onLeave={(change) => onSearch(change)}
            />
          )
        }
      </WithToolSession>
    );
  }
  if (search.scene !== undefined) {
    return (
      <FullViewer projectId={projectId} slideId={slideId} search={search} onSearch={onSearch} />
    );
  }
  return (
    <FirstReadGuard taskId={search.task} slideId={slideId}>
      <EngineViewer
        projectId={projectId}
        slideId={slideId}
        task={search.task}
        workspace={search.workspace}
        tab={search.tab}
        object={search.object}
        start={startOf(search)}
        onOpenSlide={(next) =>
          void navigate({
            to: "/projects/$projectId/slides/$slideId",
            params: { projectId, slideId: next },
            search: { task: search.task, workspace: search.workspace, tab: search.tab },
          })
        }
        onWorkspace={(workspace) => onSearch({ workspace })}
        onTab={(tab) => onSearch({ tab })}
      />
    </FirstReadGuard>
  );
}

function startOf(search: SlideSearch): StageStart | undefined {
  if (search.x === undefined || search.y === undefined) return undefined;
  return { x: search.x, y: search.y, scale: search.z ?? 1 };
}
