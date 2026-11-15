import {
  argmax,
  type LearnerClient,
  learnerInput,
  typerLogProbabilities,
} from "@parfocal/viewer-engine";

export const learnerClassKeys: readonly string[] = ["Tumor", "Stroma", "Immune", "Other"];

export const learnerRecheckAfter = 10;

export type LearnerCell = {
  object: string;
  class_name: string;
  other_class?: string | null | undefined;
  score: number;
};

export type LearnerChange = {
  from: string;
  to: string;
  inZone: boolean;
};

export type LearnerChanges = ReadonlyMap<string, LearnerChange>;

export type LearnerView = {
  examples: number;
  corrections: number;
  changes: LearnerChanges;
  failed: boolean;
};

export type LearnerInput = {
  cells: readonly LearnerCell[];
  labels: ReadonlyMap<string, string>;
  decided: (object: string) => boolean;
};

export function labelsOnceCorrected(
  labels: ReadonlyMap<string, string>,
  cells: readonly LearnerCell[],
): ReadonlyMap<string, string> {
  const byObject = new Map(cells.map((cell) => [cell.object, cell]));
  for (const [object, label] of labels) {
    const cell = byObject.get(object);
    if (cell !== undefined && cell.class_name !== label) return labels;
  }
  return new Map();
}

export type PooledFeaturesOf = (
  cells: readonly LearnerCell[],
) => Promise<ReadonlyMap<string, Float32Array>>;

export function syncFeatures(
  featureOf: (cell: LearnerCell) => Float32Array | null,
): PooledFeaturesOf {
  return (cells) => {
    const found = new Map<string, Float32Array>();
    for (const cell of cells) {
      const feature = featureOf(cell);
      if (feature !== null) found.set(cell.object, feature);
    }
    return Promise.resolve(found);
  };
}

export type SlideLearnerOptions = {
  client: LearnerClient;
  pooledFeaturesOf: PooledFeaturesOf;
  classKeys?: readonly string[];
  recheckAfter?: number;
};

export type SlideLearner = {
  update(input: LearnerInput): Promise<void>;
  undoAll(): void;
  forget(): Promise<void>;
  subscribe(listener: (view: LearnerView) => void): () => void;
  view(): LearnerView;
  close(): void;
};

export function typerProbabilities(cell: LearnerCell): Record<string, number> {
  const probabilities: Record<string, number> = { [cell.class_name]: cell.score };
  if (cell.other_class) probabilities[cell.other_class] = 1 - cell.score;
  return probabilities;
}

export function retypedCells<Cell extends LearnerCell>(
  cells: readonly Cell[],
  changes: LearnerChanges,
): Cell[] {
  return cells.map((cell) => {
    const change = changes.get(cell.object);
    return change === undefined
      ? cell
      : { ...cell, class_name: change.to, other_class: change.from };
  });
}

export function changedCellIds(changes: LearnerChanges): string[] {
  return [...changes].flatMap(([object, change]) => (change.inZone ? [object] : []));
}

export function recheckedChanges(
  cells: readonly LearnerCell[],
  previous: LearnerChanges,
  decided: (object: string) => boolean,
  predictions: ReadonlyMap<string, Float32Array | null>,
  classKeys: readonly string[],
): Map<string, LearnerChange> {
  const next = new Map<string, LearnerChange>();
  for (const cell of cells) {
    const kept = previous.get(cell.object);
    if (decided(cell.object)) {
      if (kept !== undefined) next.set(cell.object, kept);
      continue;
    }
    const prediction = predictions.get(cell.object);
    if (prediction === undefined || prediction === null) continue;
    const to = classKeys[argmax(prediction)];
    if (to === undefined || to === cell.class_name) continue;
    next.set(cell.object, { from: cell.class_name, to, inZone: true });
  }
  return next;
}

export function undoneChanges(
  previous: LearnerChanges,
  decided: (object: string) => boolean,
): Map<string, LearnerChange> {
  const next = new Map<string, LearnerChange>();
  for (const [object, change] of previous) {
    if (decided(object)) next.set(object, { ...change, inZone: false });
  }
  return next;
}

export function createSlideLearner(options: SlideLearnerOptions): SlideLearner {
  const { client, pooledFeaturesOf } = options;
  const pooled = new Map<string, Float32Array | null>();
  const classKeys = options.classKeys ?? learnerClassKeys;
  const threshold = options.recheckAfter ?? learnerRecheckAfter;
  const listeners = new Set<(view: LearnerView) => void>();
  const taught = new Map<string, string>();
  const ignored = new Map<string, string>();
  let changes: LearnerChanges = new Map();
  let opened: Promise<unknown> | null = null;
  let dims = 0;
  let checkedAt: number | null = null;
  let baseline = 0;
  let corrections = 0;
  let failed = false;
  let closed = false;
  let last: LearnerInput | null = null;
  let chain: Promise<void> = Promise.resolve();

  const snapshot = (): LearnerView => ({
    examples: taught.size,
    corrections,
    changes,
    failed,
  });

  const publish = () => {
    if (closed) return;
    const view = snapshot();
    for (const listener of listeners) listener(view);
  };

  const inputOf = (cell: LearnerCell): Float32Array | null => {
    const feature = pooled.get(cell.object);
    if (feature === undefined || feature === null) return null;
    return learnerInput(feature, typerLogProbabilities(typerProbabilities(cell), classKeys));
  };

  const ensureFeatures = async (wanted: readonly LearnerCell[]) => {
    const missing = wanted.filter((cell) => !pooled.has(cell.object));
    if (missing.length === 0) return;
    const found = await pooledFeaturesOf(missing);
    for (const cell of missing) pooled.set(cell.object, found.get(cell.object) ?? null);
  };

  const ensureOpen = async (width: number) => {
    if (opened === null) {
      dims = width;
      opened = client.open(width, classKeys, null);
    }
    await opened;
  };

  const effectiveLabels = (input: LearnerInput) => {
    const labels = new Map<string, string>();
    for (const [object, label] of input.labels) {
      if (ignored.get(object) === label) continue;
      ignored.delete(object);
      labels.set(object, label);
    }
    return labels;
  };

  const run = async (input: LearnerInput) => {
    if (closed || failed) return;
    last = input;
    const labels = effectiveLabels(input);
    const byObject = new Map(input.cells.map((cell) => [cell.object, cell]));
    try {
      for (const object of [...taught.keys()]) {
        if (labels.has(object)) continue;
        await ensureOpen(dims);
        await client.forget(object);
        taught.delete(object);
      }
      await ensureFeatures(
        [...labels.keys()].flatMap((object) => {
          const cell = byObject.get(object);
          return cell === undefined ? [] : [cell];
        }),
      );
      for (const [object, label] of labels) {
        if (taught.get(object) === label) continue;
        const cell = byObject.get(object);
        const feature = cell === undefined ? null : inputOf(cell);
        if (feature === null) continue;
        await ensureOpen(feature.length);
        await client.teach(object, feature, label);
        taught.set(object, label);
      }
      corrections = [...taught].filter(
        ([object, label]) => byObject.get(object)?.class_name !== label,
      ).length;
      const since = checkedAt ?? baseline;
      if (corrections - since >= threshold && opened !== null) {
        checkedAt = corrections;
        const open = input.cells.filter((cell) => !input.decided(cell.object));
        await ensureFeatures(open);
        const features = open.map(inputOf);
        const ready = open.flatMap((cell, index) => {
          const feature = features[index];
          return feature === null || feature === undefined ? [] : [{ cell, feature }];
        });
        const answers = await client.predict(ready.map((item) => item.feature));
        const predictions = new Map(
          ready.map((item, index) => [item.cell.object, answers[index] ?? null]),
        );
        changes = recheckedChanges(input.cells, changes, input.decided, predictions, classKeys);
      }
    } catch {
      failed = true;
    }
    publish();
  };

  return {
    update(input) {
      chain = chain.then(() => run(input));
      return chain;
    },
    undoAll() {
      checkedAt = null;
      baseline = corrections;
      changes = undoneChanges(changes, last?.decided ?? (() => false));
      publish();
    },
    forget() {
      chain = chain.then(async () => {
        if (closed) return;
        for (const [object, label] of taught) ignored.set(object, label);
        taught.clear();
        corrections = 0;
        baseline = 0;
        checkedAt = null;
        changes = undoneChanges(changes, last?.decided ?? (() => false));
        try {
          if (opened !== null) opened = client.open(dims, classKeys, null);
          await opened;
        } catch {
          failed = true;
        }
        publish();
      });
      return chain;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    view: snapshot,
    close() {
      closed = true;
      listeners.clear();
      client.close();
    },
  };
}
