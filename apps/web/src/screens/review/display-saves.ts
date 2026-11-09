export type LatestQueue = {
  run: <T>(
    send: () => Promise<T>,
    apply: (result: T) => void,
    recover: () => void,
  ) => Promise<void>;
  idle: () => boolean;
};

export function createLatestQueue(): LatestQueue {
  let tail: Promise<void> = Promise.resolve();
  let newest = 0;
  let waiting = 0;
  return {
    run(send, apply, recover) {
      newest += 1;
      const mine = newest;
      waiting += 1;
      tail = tail.then(async () => {
        try {
          const result = await send();
          if (mine === newest) apply(result);
        } catch {
          recover();
        } finally {
          waiting -= 1;
        }
      });
      return tail;
    },
    idle: () => waiting === 0,
  };
}

export async function saveThenChoose<T>(steps: {
  save: () => Promise<T>;
  choose: (saved: T) => Promise<unknown>;
  discard: (saved: T) => Promise<unknown>;
}): Promise<T> {
  const saved = await steps.save();
  try {
    await steps.choose(saved);
  } catch (error) {
    await steps.discard(saved).catch(() => undefined);
    throw error;
  }
  return saved;
}
