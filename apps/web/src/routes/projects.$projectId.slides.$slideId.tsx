import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { stayTools } from "../screens/review/review-rail.ts";
import { mockScenes } from "../screens/scenes.ts";
import { FullViewer } from "../screens/viewer/full-viewer.tsx";
import { isCompareScene, viewerTabs } from "../screens/viewer/viewer-scenes.ts";
import { CompareView } from "../screens/viewer-tools/compare-view.tsx";
import { FocusView } from "../screens/viewer-tools/focus-view.tsx";
import { WithToolSession } from "../screens/viewer-tools/tool-session.tsx";
import { loadViewerEngine } from "../viewer/load-engine.ts";

const slideSearch = z.object({
  task: z.string().optional(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  z: z.number().min(0).max(20).optional(),
  object: z.string().optional(),
  with: z.string().optional(),
  scene: z
    .enum([
      ...mockScenes.case,
      ...mockScenes.layers,
      ...mockScenes.navigator,
      ...mockScenes.compare,
    ])
    .optional(),
  tool: z.enum(stayTools).optional(),
  focus: z.boolean().optional(),
  peek: z.boolean().optional(),
  tab: z.enum(viewerTabs).optional(),
  modal: z.enum(["preset"]).optional(),
});

export type SlideSearch = z.infer<typeof slideSearch>;

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
