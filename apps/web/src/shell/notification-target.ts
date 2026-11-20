import type { Target } from "@parfocal/api-client";
import { destinations } from "./destinations.ts";
import { slideHref } from "./slide-link.ts";

const given = (value: string | null | undefined) => value ?? undefined;

function slideTargetHref(target: Target, comments: boolean): string | null {
  if (target.project_id === null || !target.slide_id) return null;
  return slideHref({
    projectId: target.project_id,
    slideId: target.slide_id,
    taskId: given(target.task_id),
    object: given(target.object_id),
    tab: comments ? "comments" : undefined,
  });
}

export function targetHref(target: Target): string | null {
  switch (target.kind) {
    case "slide":
    case "decision":
      return slideTargetHref(target, false);
    case "thread":
      return slideTargetHref(target, true);
    case "task":
      if (!target.task_id) return null;
      return target.slide_id
        ? destinations.adjudicate(target.task_id)
        : `/tasks/${target.task_id}/guided`;
    case "evaluation":
      return target.task_id ? destinations.evaluation(target.task_id) : null;
    case "job":
      return target.project_id && target.job_id
        ? `/projects/${target.project_id}/jobs/${target.job_id}`
        : null;
    case "project":
      return target.project_id ? destinations.project(target.project_id) : null;
    case "delivery":
      return "/admin?section=api";
    case "source":
      return "/admin?section=storage";
    case "access-request":
    case "template-offer":
      return null;
  }
}
