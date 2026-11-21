const submitted = new Map<string, Set<string>>();

const keyOf = (taskId: string, viewer: string) => `${taskId}:${viewer}`;

export const markSlideSubmitted = (taskId: string, slideId: string, viewer: string) => {
  const key = keyOf(taskId, viewer);
  const done = submitted.get(key) ?? new Set<string>();
  done.add(slideId);
  submitted.set(key, done);
};

export const submittedThisSession = (taskId: string, viewer: string): ReadonlySet<string> =>
  submitted.get(keyOf(taskId, viewer)) ?? new Set<string>();
