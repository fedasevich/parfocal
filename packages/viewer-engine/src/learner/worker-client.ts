import { onWorkerFailure, type WorkerHandle } from "../decode/protocol.ts";
import type { SavedLearner } from "./learner-state.ts";
import type { LearnerReply, LearnerRequest, LearnerStatus, LearnerTaught } from "./protocol.ts";

export type LearnerWorker = WorkerHandle<LearnerRequest, LearnerReply>;

export interface LearnerOpened {
  readonly status: LearnerStatus;
  readonly restored: boolean;
}

export interface LearnerClient {
  open(
    dims: number,
    classKeys: readonly string[],
    saved: SavedLearner | null,
  ): Promise<LearnerOpened>;
  teach(key: string, feature: Float32Array, classKey: string): Promise<LearnerTaught>;
  forget(key: string): Promise<LearnerTaught>;
  predict(features: readonly Float32Array[]): Promise<(Float32Array | null)[]>;
  save(): Promise<SavedLearner>;
  close(): void;
}

export class LearnerWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearnerWorkerError";
  }
}

export class LearnerClientClosedError extends Error {
  constructor() {
    super("The learner client was closed");
    this.name = "LearnerClientClosedError";
  }
}

export function spawnLearnerWorker(): LearnerWorker {
  return new Worker(new URL("../workers/learner.worker.ts", import.meta.url), {
    type: "module",
    name: "parfocal-learner",
  });
}

interface Waiting {
  readonly resolve: (reply: LearnerReply) => void;
  readonly reject: (error: Error) => void;
}

type Body<Request> = Request extends unknown ? Omit<Request, "requestId"> : never;

export function createLearnerClient(
  spawn: () => LearnerWorker = spawnLearnerWorker,
): LearnerClient {
  const worker = spawn();
  const waiting = new Map<number, Waiting>();
  let nextRequestId = 0;
  let closed = false;
  let failure: LearnerWorkerError | null = null;

  onWorkerFailure(worker, "learner", (reason) => {
    if (failure !== null || closed) return;
    failure = new LearnerWorkerError(reason);
    for (const waiter of waiting.values()) waiter.reject(failure);
    waiting.clear();
  });

  worker.addEventListener("message", (event) => {
    const reply = event.data;
    const waiter = waiting.get(reply.requestId);
    if (waiter === undefined) return;
    waiting.delete(reply.requestId);
    if (reply.type === "failed") waiter.reject(new LearnerWorkerError(reply.message));
    else waiter.resolve(reply);
  });

  function request(
    body: Body<LearnerRequest>,
    transfer: Transferable[] = [],
  ): Promise<LearnerReply> {
    if (closed) return Promise.reject(new LearnerClientClosedError());
    if (failure !== null) return Promise.reject(failure);
    return new Promise<LearnerReply>((resolve, reject) => {
      const requestId = nextRequestId++;
      waiting.set(requestId, { resolve, reject });
      worker.postMessage({ ...body, requestId }, transfer);
    });
  }

  function unexpected(reply: LearnerReply): never {
    throw new LearnerWorkerError(`Unexpected reply ${reply.type}`);
  }

  return {
    async open(dims, classKeys, saved) {
      const reply = await request({ type: "open", dims, classKeys: [...classKeys], saved });
      return reply.type === "opened"
        ? { status: reply.status, restored: reply.restored }
        : unexpected(reply);
    },
    async teach(key, feature, classKey) {
      const copy = Float32Array.from(feature);
      const reply = await request({ type: "teach", key, feature: copy, classKey }, [copy.buffer]);
      return reply.type === "taught" ? reply.taught : unexpected(reply);
    },
    async forget(key) {
      const reply = await request({ type: "forget", key });
      return reply.type === "forgot" ? reply.taught : unexpected(reply);
    },
    async predict(features) {
      const copies = features.map((feature) => Float32Array.from(feature));
      const reply = await request(
        { type: "predict", features: copies },
        copies.map((copy) => copy.buffer),
      );
      return reply.type === "predicted" ? [...reply.predictions] : unexpected(reply);
    },
    async save() {
      const reply = await request({ type: "save" });
      return reply.type === "saved" ? reply.saved : unexpected(reply);
    },
    close() {
      if (closed) return;
      closed = true;
      worker.terminate();
      const error = new LearnerClientClosedError();
      for (const waiter of waiting.values()) waiter.reject(error);
      waiting.clear();
    },
  };
}
