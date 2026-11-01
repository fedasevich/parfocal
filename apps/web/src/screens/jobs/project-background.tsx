import type { ReactNode } from "react";
import { ProjectPage } from "../project/project-page.tsx";

export function ProjectBackground({
  projectId,
  children,
}: {
  projectId: string;
  children?: ReactNode;
}) {
  return <ProjectPage projectId={projectId} view={{ tab: "slides" }} overlay={children} />;
}
