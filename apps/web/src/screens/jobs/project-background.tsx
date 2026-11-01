import type { ReactNode } from "react";
import { ProjectPage, type ProjectTab } from "../project/project-page.tsx";

export function ProjectBackground({
  projectId,
  tab = "slides",
  children,
}: {
  projectId: string;
  tab?: ProjectTab;
  children?: ReactNode;
}) {
  return <ProjectPage projectId={projectId} view={{ tab }} overlay={children} />;
}
