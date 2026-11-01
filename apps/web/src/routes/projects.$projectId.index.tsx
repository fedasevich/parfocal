import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProjectPage, type ProjectTab } from "../screens/project/project-page.tsx";
import { useResultsSlide } from "../screens/project/scene.ts";
import { mockScenes } from "../screens/scenes.ts";

const projectSearch = z.object({
  tab: z.enum(["slides", "results", "tasks", "report", "settings"]).default("slides"),
  status: z.string().optional(),
  q: z.string().optional(),
  sets: z.string().optional(),
  modal: z.enum(["addcls"]).optional(),
  scene: z.enum(mockScenes.project).optional(),
});

export const Route = createFileRoute("/projects/$projectId/")({
  validateSearch: projectSearch,
  component: ProjectRoute,
});

const tabOf = (tab: z.infer<typeof projectSearch>["tab"]): ProjectTab =>
  tab === "tasks" || tab === "settings" ? tab : "slides";

function ProjectRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const scene = search.scene;
  const resultsSlide = useResultsSlide(projectId, scene === "results");
  const tab =
    scene === "tasks" || scene === "settings"
      ? scene
      : scene === undefined
        ? tabOf(search.tab)
        : "slides";
  return (
    <ProjectPage
      key={scene ?? "live"}
      projectId={projectId}
      view={{
        tab,
        open: scene === "results" ? resultsSlide : search.sets,
        importFailed: scene === "importfail",
        addClass: tab === "settings" && search.modal === "addcls",
      }}
    />
  );
}
