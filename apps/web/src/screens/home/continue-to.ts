import type { ResumeTarget } from "@parfocal/api-client";
import { destinations } from "../../shell/destinations.ts";

export function continueTo(resume: ResumeTarget) {
  const object = resume.object_id ?? undefined;
  if (resume.mode === "viewer")
    return destinations.slide(
      resume.project.id,
      resume.slide_id,
      resume.task_id,
      object,
      resume.camera ?? {},
    );
  return destinations.guided(resume.task_id, resume.slide_id, object, resume.camera ?? null);
}

export function openInFullViewer(resume: ResumeTarget) {
  return destinations.slide(
    resume.project.id,
    resume.slide_id,
    resume.task_id,
    resume.object_id ?? undefined,
  );
}
