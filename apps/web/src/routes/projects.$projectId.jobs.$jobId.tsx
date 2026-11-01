import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { JobWindowScreen } from "../screens/jobs/job-window-screen.tsx";
import { ProjectBackground } from "../screens/jobs/project-background.tsx";
import { useJobsTray } from "../shell/jobs-tray.tsx";

export const Route = createFileRoute("/projects/$projectId/jobs/$jobId")({
  component: AJobAndItsSteps,
});

function AJobAndItsSteps() {
  const { projectId, jobId } = Route.useParams();
  const navigate = useNavigate();
  const tray = useJobsTray();
  return (
    <ProjectBackground projectId={projectId}>
      <JobWindowScreen
        projectId={projectId}
        jobId={jobId}
        onClose={() => {
          void navigate({ to: "/projects/$projectId", params: { projectId } }).then(() =>
            tray.setOpen(true),
          );
        }}
      />
    </ProjectBackground>
  );
}
