import { createFileRoute } from "@tanstack/react-router";
import { ProjectPage, type ProjectTab } from "../screens/project/project-page.tsx";
import { useResultsSlide } from "../screens/project/scene.ts";
import { type ProjectSearch, projectSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/projects/$projectId/")({
  validateSearch: projectSearch,
  component: ProjectRoute,
});

const tabOf = (tab: ProjectSearch["tab"]): ProjectTab =>
  tab === "tasks" || tab === "settings" ? tab : tab === "people" ? "settings" : "slides";

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
        addPerson: tab === "settings" ? search.add : undefined,
      }}
    />
  );
}
