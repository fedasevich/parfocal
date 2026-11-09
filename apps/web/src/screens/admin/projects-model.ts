import type { Project } from "@parfocal/api-client";

export type ProjectView = "active" | "archived";

type Archivable = Pick<Project, "archived_at" | "my_role">;

export const isArchived = (project: Pick<Project, "archived_at">): boolean =>
  project.archived_at !== null;

export const projectStatusLabel = (project: Pick<Project, "archived_at">): string =>
  isArchived(project) ? "Archived" : "Active";

export const canChangeArchive = (project: Pick<Project, "my_role">): boolean =>
  project.my_role === "owner";

export const archiveActionLabel = (project: Pick<Project, "archived_at">): string =>
  isArchived(project) ? "Unarchive" : "Archive";

export const archiveDoneNotice = (before: Pick<Project, "archived_at" | "name">): string =>
  isArchived(before)
    ? `${before.name} is active again`
    : `${before.name} is archived. It stays readable and can be unarchived`;

export const archiveRefusalNotice = (project: Archivable): string =>
  canChangeArchive(project)
    ? "That did not save. Try again"
    : "Only a project owner can archive or unarchive it";

export const projectsCountLabel = (count: number, view: ProjectView): string =>
  `${count} ${view === "archived" ? "archived" : "active"} ${count === 1 ? "project" : "projects"}`;
