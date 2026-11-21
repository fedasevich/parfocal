export const defaultOutlineOverlap = 60;

const chosen = new Map<string, number>();

export const outlineOverlapOf = (taskId: string) => chosen.get(taskId) ?? defaultOutlineOverlap;

export const setOutlineOverlap = (taskId: string, percent: number) => {
  chosen.set(taskId, percent);
};
