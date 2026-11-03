import { useGetProject } from "@parfocal/api-client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { okData } from "../screens/placeholder.tsx";
import { NewCaseDrawer } from "../screens/project/drawers.tsx";
import { ProjectPage } from "../screens/project/project-page.tsx";

export const Route = createFileRoute("/projects/$projectId/cases/new")({
  component: NewCaseRoute,
});

function NewCaseRoute() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const project = okData(useGetProject(projectId).data);
  const close = () => void navigate({ to: "/projects/$projectId", params: { projectId } });
  return (
    <ProjectPage
      projectId={projectId}
      view={{ tab: "slides" }}
      overlay={
        project ? <NewCaseDrawer project={project} onClose={close} onCreated={close} /> : null
      }
    />
  );
}
