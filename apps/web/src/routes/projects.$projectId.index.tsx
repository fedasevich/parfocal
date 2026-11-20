import { createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { ProjectPage, type ProjectTab } from "../screens/project/project-page.tsx";
import { useResultsSlide } from "../screens/project/scene.ts";
import { type ProjectSearch, projectSearch } from "../search/route-searches.ts";
import { unknownValuesOf } from "../search/unknown-values.ts";

const knownTabs = ["slides", "results", "tasks", "report", "settings", "people"];
const renamedTabs = ["results", "report", "people"];

const movedFromOf = (state: unknown): string | undefined => {
  if (typeof state !== "object" || state === null) return undefined;
  const from = (state as { movedFrom?: unknown }).movedFrom;
  return typeof from === "string" ? from : undefined;
};

const tabOf = (tab: ProjectSearch["tab"]): ProjectTab =>
  tab === "tasks" || tab === "settings" ? tab : tab === "people" ? "settings" : "slides";

export const Route = createFileRoute("/projects/$projectId/")({
  validateSearch: projectSearch,
  beforeLoad: ({ params, search, location }) => {
    if (search.scene !== undefined) return;
    const unknown = unknownValuesOf(location.searchStr, { tab: knownTabs }).length > 0;
    if (!unknown && tabOf(search.tab) === search.tab) return;
    throw redirect({
      to: "/projects/$projectId",
      params,
      search: { ...search, tab: tabOf(search.tab) },
      replace: true,
      state: (renamedTabs.includes(search.tab) && !unknown
        ? { movedFrom: search.tab }
        : {}) as never,
    });
  },
  component: ProjectRoute,
});

function ProjectRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const scene = search.scene;
  const movedFrom = useLocation({ select: (location) => movedFromOf(location.state) });
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
        movedFrom,
      }}
    />
  );
}
