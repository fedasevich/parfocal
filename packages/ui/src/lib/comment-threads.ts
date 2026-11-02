export type ThreadFilter = "open" | "resolved";

export type ThreadSummary = {
  id: string;
  resolved: boolean;
};

export const filterThreads = <T extends ThreadSummary>(threads: T[], filter: ThreadFilter): T[] =>
  threads.filter((thread) => thread.resolved === (filter === "resolved"));

export const countThreads = (threads: ThreadSummary[]): Record<ThreadFilter, number> => ({
  open: filterThreads(threads, "open").length,
  resolved: filterThreads(threads, "resolved").length,
});

export const filterOfThread = (
  threads: ThreadSummary[],
  id: string | undefined,
): ThreadFilter | undefined => {
  const found = threads.find((thread) => thread.id === id);
  if (found === undefined) return undefined;
  return found.resolved ? "resolved" : "open";
};

export const emptyThreadsLine = (filter: ThreadFilter, otherCount: number) => {
  if (filter === "resolved") return "No resolved threads yet.";
  return otherCount > 0
    ? "No open threads. Resolved ones are under Resolved."
    : "No comments on this slide yet.";
};
