import { errorMessage, type MessageTarget } from "../decode/protocol.ts";
import { restoreLearner, saveLearner } from "./learner-state.ts";
import type { LearnerReply, LearnerRequest, LearnerStatus, LearnerTaught } from "./protocol.ts";
import { createTypeLearner, type LearnerSettings, type TypeLearner } from "./type-learner.ts";

export type LearnerWorkerScope = MessageTarget<LearnerReply, LearnerRequest>;

export interface LearnerWorkerOptions {
  readonly now?: () => number;
  readonly settings?: Partial<LearnerSettings>;
}

interface Open {
  readonly learner: TypeLearner;
  readonly classKeys: readonly string[];
}

const statusOf = (learner: TypeLearner): LearnerStatus => ({
  count: learner.count,
  ready: learner.ready,
  trained: learner.trained,
});

export function startLearnerWorker(
  scope: LearnerWorkerScope,
  options: LearnerWorkerOptions = {},
): void {
  const now = options.now ?? (() => performance.now());
  const settings = options.settings ?? {};
  let open: Open | null = null;

  const opened = (requestId: number): Open => {
    if (open === null)
      throw new Error(`The learner worker has no slide open for request ${requestId}`);
    return open;
  };

  const retrain = (learner: TypeLearner): LearnerTaught => {
    const started = now();
    learner.train();
    return { status: statusOf(learner), ms: now() - started };
  };

  const handle = (message: LearnerRequest) => {
    switch (message.type) {
      case "open": {
        const restored =
          message.saved === null
            ? null
            : restoreLearner(message.saved, message.dims, message.classKeys, settings);
        const learner =
          restored ?? createTypeLearner(message.dims, message.classKeys.length, settings);
        open = { learner, classKeys: [...message.classKeys] };
        scope.postMessage(
          {
            type: "opened",
            requestId: message.requestId,
            status: statusOf(learner),
            restored: restored !== null,
          },
          [],
        );
        return;
      }
      case "teach": {
        const { learner, classKeys } = opened(message.requestId);
        const label = classKeys.indexOf(message.classKey);
        if (label < 0) throw new Error(`The class ${message.classKey} is not on this slide`);
        learner.teach(message.key, message.feature, label);
        scope.postMessage(
          { type: "taught", requestId: message.requestId, taught: retrain(learner) },
          [],
        );
        return;
      }
      case "forget": {
        const { learner } = opened(message.requestId);
        learner.forget(message.key);
        scope.postMessage(
          { type: "forgot", requestId: message.requestId, taught: retrain(learner) },
          [],
        );
        return;
      }
      case "predict": {
        const { learner } = opened(message.requestId);
        const predictions = message.features.map(
          (feature) => learner.predict(feature) as Float32Array<ArrayBuffer> | null,
        );
        const transfer = predictions.flatMap((row) => (row === null ? [] : [row.buffer]));
        scope.postMessage(
          { type: "predicted", requestId: message.requestId, predictions },
          transfer,
        );
        return;
      }
      case "save": {
        const { learner, classKeys } = opened(message.requestId);
        scope.postMessage(
          { type: "saved", requestId: message.requestId, saved: saveLearner(learner, classKeys) },
          [],
        );
        return;
      }
    }
  };

  scope.addEventListener("message", (event) => {
    const message = event.data;
    try {
      handle(message);
    } catch (error) {
      scope.postMessage(
        { type: "failed", requestId: message.requestId, message: errorMessage(error) },
        [],
      );
    }
  });
}
