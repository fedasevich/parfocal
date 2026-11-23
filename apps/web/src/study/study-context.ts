import {
  useGetMyHome,
  useListMySlides,
  useListProjects,
  useListReviewTasks,
} from "@parfocal/api-client";
import { okData } from "../screens/placeholder.tsx";
import {
  type ParticipantProject,
  participantProjectName,
  participantProjectOf,
} from "./participant-project.ts";
import type { StudyContext } from "./study-model.ts";

type SlideRow = StudyContext["slides"][number];

export function useParticipantProject(
  code: string | undefined,
  slides: SlideRow[],
): ParticipantProject | undefined {
  const projects = okData(useListProjects().data) ?? [];
  const project =
    code === undefined
      ? undefined
      : projects.find((row) => row.name === participantProjectName(code));
  const tasks = okData(useListReviewTasks(project?.id ?? "").data) ?? [];
  if (code === undefined || project === undefined) return undefined;
  return participantProjectOf(code, {
    projects: projects.map((row) => ({ id: row.id, name: row.name })),
    tasks: tasks.map((row) => ({ id: row.id, name: row.name, projectId: row.project_id })),
    slides,
  });
}

export function useStudyContext(participantCode?: string): StudyContext {
  const slides = okData(useListMySlides().data)?.slides ?? [];
  const resume = okData(useGetMyHome().data)?.resume ?? null;
  const participant = useParticipantProject(participantCode, slides);
  return {
    slides,
    resume:
      resume === null
        ? null
        : { projectId: resume.project.id, slideId: resume.slide_id, taskId: resume.task_id },
    participant: participant ?? null,
  };
}
