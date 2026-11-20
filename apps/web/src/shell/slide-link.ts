export type SlideView = {
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly z?: number | undefined;
};

export type SlideLinkTarget = {
  readonly projectId: string;
  readonly slideId: string;
  readonly taskId?: string | undefined;
  readonly object?: string | undefined;
  readonly view?: SlideView | undefined;
};

export const slidePath = "/projects/$projectId/slides/$slideId" as const;

export function slideLink(target: SlideLinkTarget) {
  return {
    to: slidePath,
    params: { projectId: target.projectId, slideId: target.slideId },
    search: {
      task: target.taskId,
      object: target.object,
      x: target.view?.x,
      y: target.view?.y,
      z: target.view?.z,
    },
  };
}

export function slideHref(target: SlideLinkTarget): string {
  const { params, search } = slideLink(target);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const text = query.toString();
  return `/projects/${params.projectId}/slides/${params.slideId}${text ? `?${text}` : ""}`;
}
