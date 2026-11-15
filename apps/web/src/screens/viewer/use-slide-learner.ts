import { createLearnerClient, type LearnerClient } from "@parfocal/viewer-engine";
import { useEffect, useRef, useState } from "react";
import {
  createSlideLearner,
  type LearnerInput,
  type LearnerView,
  type PooledFeaturesOf,
  type SlideLearner,
} from "./slide-learner.ts";

export const emptyLearnerView: LearnerView = {
  examples: 0,
  corrections: 0,
  changes: new Map(),
  failed: false,
};

type UseSlideLearner = {
  slideKey: string;
  enabled: boolean;
  pooledFeaturesOf: PooledFeaturesOf;
  input: LearnerInput;
  onView: (view: LearnerView) => void;
  recheckAfter?: number;
  createClient?: () => LearnerClient;
};

export function useSlideLearner({
  slideKey,
  enabled,
  pooledFeaturesOf,
  input,
  onView,
  recheckAfter,
  createClient = createLearnerClient,
}: UseSlideLearner) {
  const [owned, setOwned] = useState<{ slideKey: string; learner: SlideLearner } | null>(null);
  const latest = useRef({ onView, pooledFeaturesOf, createClient });
  latest.current = { onView, pooledFeaturesOf, createClient };

  useEffect(() => {
    if (!enabled) return;
    const made = createSlideLearner({
      client: latest.current.createClient(),
      pooledFeaturesOf: (cells) => latest.current.pooledFeaturesOf(cells),
      ...(recheckAfter === undefined ? {} : { recheckAfter }),
    });
    const stop = made.subscribe((view) => latest.current.onView(view));
    setOwned({ slideKey, learner: made });
    return () => {
      stop();
      made.close();
      setOwned(null);
      latest.current.onView(emptyLearnerView);
    };
  }, [enabled, slideKey, recheckAfter]);

  const learner = owned?.slideKey === slideKey ? owned.learner : null;

  const inputKey = [
    ...[...input.labels].map(([object, label]) => `${object}=${label}`).sort(),
    "|",
    ...input.cells.filter((cell) => input.decided(cell.object)).map((cell) => cell.object),
  ].join(",");
  const inputRef = useRef(input);
  inputRef.current = input;
  const sentKey = useRef<{ learner: SlideLearner; key: string } | null>(null);

  useEffect(() => {
    if (learner === null) return;
    if (sentKey.current?.learner === learner && sentKey.current.key === inputKey) return;
    sentKey.current = { learner, key: inputKey };
    void learner.update(inputRef.current);
  }, [learner, inputKey]);

  return {
    undoAll: () => learner?.undoAll(),
    forget: () => void learner?.forget(),
  };
}
