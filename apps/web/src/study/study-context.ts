import { useGetMyHome, useListMySlides } from "@parfocal/api-client";
import { okData } from "../screens/placeholder.tsx";
import type { ParticipantTokens, StudyContext } from "./study-model.ts";

export function useParticipantTokens(_code: string | undefined): ParticipantTokens {
  return {};
}

export function useStudyContext(participantCode?: string): StudyContext {
  const slides = okData(useListMySlides().data)?.slides ?? [];
  const resume = okData(useGetMyHome().data)?.resume ?? null;
  const participant = useParticipantTokens(participantCode);
  return {
    slides,
    resume:
      resume === null
        ? null
        : { projectId: resume.project.id, slideId: resume.slide_id, taskId: resume.task_id },
    participant,
  };
}
