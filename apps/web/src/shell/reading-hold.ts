export type ReadingHold = {
  open: (at: number) => void;
  touch: (at: number) => void;
  close: () => void;
  isHeld: (at: number, idleMinutes: number) => boolean;
};

export function createReadingHold(): ReadingHold {
  let reportedAt: number | null = null;
  return {
    open: (at) => {
      reportedAt = at;
    },
    touch: (at) => {
      if (reportedAt !== null) reportedAt = at;
    },
    close: () => {
      reportedAt = null;
    },
    isHeld: (at, idleMinutes) => reportedAt !== null && at - reportedAt < idleMinutes * 60_000,
  };
}

export const readingHold = createReadingHold();

export const isSlideRoute = (routeId: string): boolean =>
  routeId.startsWith("/projects/$projectId/slides/$slideId");
