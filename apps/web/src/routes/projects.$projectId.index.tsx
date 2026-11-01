import { useGetProject } from "@parfocal/api-client";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { okData, Placeholder, QueryState } from "../screens/placeholder.tsx";

const projectSearch = z.object({
  tab: z.enum(["slides", "results", "tasks", "report", "settings"]).default("slides"),
  status: z.string().optional(),
  q: z.string().optional(),
});

export const Route = createFileRoute("/projects/$projectId/")({
  validateSearch: projectSearch,
  component: ProjectPage,
});

function ProjectPage() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const project = useGetProject(params.projectId);
  const body = okData(project.data);
  return (
    <Placeholder
      title="Project"
      builtBy="PROTO-004 (project page, new project and upload)"
      route={{ params, search }}
    >
      <QueryState label="the project" isPending={project.isPending} error={project.error}>
        {body && (
          <p className="text-fg" data-testid="project-name">
            {body.code} · {body.name}
          </p>
        )}
      </QueryState>
    </Placeholder>
  );
}
