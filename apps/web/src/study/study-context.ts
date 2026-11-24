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

export type ParticipantLookup =
  | { state: "none" }
  | { state: "loading" }
  | { state: "missing" }
  | { state: "found"; project: ParticipantProject };

export function useParticipantLookup(code: string | undefined): ParticipantLookup {
  const slideList = useListMySlides();
  const projectList = useListProjects();
  const projects = okData(projectList.data);
  const project =
    code === undefined
      ? undefined
      : projects?.find((row) => row.name === participantProjectName(code));
  const taskList = useListReviewTasks(project?.id ?? "", {
    query: { enabled: project !== undefined },
  });
  if (code === undefined) return { state: "none" };
  if (projects === undefined) return { state: projectList.isError ? "missing" : "loading" };
  if (project === undefined) return { state: "missing" };
  const tasks = okData(taskList.data);
  const slides = okData(slideList.data)?.slides;
  if (tasks === undefined || slides === undefined) {
    return { state: taskList.isError || slideList.isError ? "missing" : "loading" };
  }
  const found = participantProjectOf(code, {
    projects: projects.map((row) => ({ id: row.id, name: row.name })),
    tasks: tasks.map((row) => ({ id: row.id, name: row.name, projectId: row.project_id })),
    slides,
  });
  return found === undefined ? { state: "missing" } : { state: "found", project: found };
}

export function useParticipantProject(code: string | undefined): ParticipantProject | undefined {
  const lookup = useParticipantLookup(code);
  return lookup.state === "found" ? lookup.project : undefined;
}

export function useStudyContext(participantCode?: string): StudyContext {
  const slides: SlideRow[] = okData(useListMySlides().data)?.slides ?? [];
  const resume = okData(useGetMyHome().data)?.resume ?? null;
  const participant = useParticipantProject(participantCode);
  return {
    slides,
    resume:
      resume === null
        ? null
        : { projectId: resume.project.id, slideId: resume.slide_id, taskId: resume.task_id },
    participant: participant ?? null,
  };
}
