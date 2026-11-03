import { useListProjects } from "@parfocal/api-client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { okData } from "../screens/placeholder.tsx";
import { NewProjectDrawer } from "../screens/project/drawers.tsx";
import { ProjectPage } from "../screens/project/project-page.tsx";

export const Route = createFileRoute("/projects/new")({
  component: NewProjectRoute,
});

function NewProjectRoute() {
  const navigate = useNavigate();
  const behind = okData(useListProjects().data)?.[0];
  if (behind === undefined) return null;
  const close = () =>
    void navigate({ to: "/projects/$projectId", params: { projectId: behind.id } });
  return (
    <ProjectPage
      projectId={behind.id}
      view={{ tab: "slides" }}
      overlay={
        <NewProjectDrawer
          onClose={close}
          onCreated={(created) =>
            void navigate({
              to: "/projects/$projectId/upload",
              params: { projectId: created.id },
            })
          }
        />
      }
    />
  );
}
