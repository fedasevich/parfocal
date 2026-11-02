import { useGetProject } from "@parfocal/api-client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { okData } from "../screens/placeholder.tsx";
import { ProjectPage } from "../screens/project/project-page.tsx";
import { CaseUploadDrawer } from "../screens/upload/case-upload-drawer.tsx";

export const Route = createFileRoute("/projects/$projectId/cases/$caseId/upload")({
  component: CaseUploadRoute,
});

function CaseUploadRoute() {
  const { projectId, caseId } = Route.useParams();
  const navigate = useNavigate();
  const project = okData(useGetProject(projectId).data);
  const close = () => void navigate({ to: "/projects/$projectId", params: { projectId } });
  return (
    <ProjectPage
      projectId={projectId}
      view={{ tab: "slides" }}
      overlay={
        project ? <CaseUploadDrawer project={project} caseId={caseId} onClose={close} /> : null
      }
    />
  );
}
