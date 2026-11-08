export interface TileLoadState {
  readonly pending: number;
  readonly waitingMs: number;
  readonly answerMs: number | null;
}

export interface TileWait {
  readonly begin: () => number;
  readonly end: (id: number, answered: boolean) => void;
  readonly state: () => TileLoadState;
}

const recentAnswers = 8;

export function createTileWait(now: () => number): TileWait {
  const open = new Map<number, number>();
  const answers: number[] = [];
  let next = 0;
  let waitStart = 0;

  const begin = () => {
    if (open.size === 0) waitStart = now();
    const id = next++;
    open.set(id, now());
    return id;
  };

  const end = (id: number, answered: boolean) => {
    const started = open.get(id);
    if (started === undefined) return;
    open.delete(id);
    if (!answered) return;
    answers.push(now() - started);
    if (answers.length > recentAnswers) answers.shift();
  };

  const state = (): TileLoadState => {
    const current = now();
    let oldest = 0;
    for (const started of open.values()) oldest = Math.max(oldest, current - started);
    const mean = answers.length === 0 ? 0 : answers.reduce((a, b) => a + b, 0) / answers.length;
    const answerMs = Math.max(oldest, mean);
    return {
      pending: open.size,
      waitingMs: open.size === 0 ? 0 : current - waitStart,
      answerMs: answerMs > 0 ? answerMs : null,
    };
  };

  return { begin, end, state };
}
