import { createFileRoute } from "@tanstack/react-router";
import { FullViewer } from "../screens/viewer/full-viewer.tsx";
import { isCompareScene } from "../screens/viewer/viewer-scenes.ts";
import { CompareView } from "../screens/viewer-tools/compare-view.tsx";
import { FocusView } from "../screens/viewer-tools/focus-view.tsx";
import { WithToolSession } from "../screens/viewer-tools/tool-session.tsx";
import { type SlideSearch, slideSearch } from "../search/route-searches.ts";
import { loadViewerEngine } from "../viewer/load-engine.ts";

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
              onShowUi={() => onSearch({ focus: undefined, peek: undefined })}
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
  return <FullViewer projectId={projectId} slideId={slideId} search={search} onSearch={onSearch} />;
}
