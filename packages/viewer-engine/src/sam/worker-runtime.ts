import { errorMessage, type MessageTarget } from "../decode/protocol.ts";
import type { InferenceEngine, SamOutputs } from "./inference-engine.ts";
import type { SamReply, SamRequest } from "./protocol.ts";
import type { SamGraph } from "./variants.ts";

export type SamWorkerScope = MessageTarget<SamReply, SamRequest>;

export interface SamWorkerDependencies {
  createEngine(modelsUrl: string, onStage: (graph: SamGraph) => void): InferenceEngine;
}

function transferList(outputs: SamOutputs): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const output of Object.values(outputs)) {
    buffers.add(output.data.buffer as ArrayBuffer);
  }
  return [...buffers];
}

export function startSamWorker(scope: SamWorkerScope, dependencies: SamWorkerDependencies): void {
  let engine: InferenceEngine | null = null;

  const fail = (requestId: number | null, error: unknown) => {
    scope.postMessage({ type: "failed", requestId, message: errorMessage(error) }, []);
  };

  const withEngine = (requestId: number, job: (engine: InferenceEngine) => Promise<void>) => {
    if (engine === null) {
      fail(requestId, new Error("The inference worker has not been started"));
      return;
    }
    job(engine).catch((error: unknown) => fail(requestId, error));
  };

  scope.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "init") {
      if (engine !== null) {
        return;
      }
      engine = dependencies.createEngine(message.modelsUrl, (graph) =>
        scope.postMessage({ type: "stage", graph }, []),
      );
      engine.init().then(
        (ready) => scope.postMessage({ type: "ready", ready }, []),
        (error: unknown) => fail(null, error),
      );
      return;
    }
    if (message.type === "encode") {
      const { requestId, id, pixels } = message;
      withEngine(requestId, async (active) => {
        const encoded = await active.encode(id, pixels);
        scope.postMessage({ type: "encoded", requestId, encoded }, []);
      });
      return;
    }
    if (message.type === "prompt") {
      const { requestId, id, prompt } = message;
      withEngine(requestId, async (active) => {
        const outcome = await active.prompt(id, prompt);
        const transfer = outcome.status === "answer" ? transferList(outcome.outputs) : [];
        scope.postMessage({ type: "prompted", requestId, outcome }, transfer);
      });
      return;
    }
    if (message.type === "segmentAll") {
      const { requestId, id } = message;
      withEngine(requestId, async (active) => {
        const outputs = await active.segmentAll(id);
        scope.postMessage({ type: "segmented", requestId, outputs }, transferList(outputs));
      });
      return;
    }
    engine?.drop(message.id);
  });
}
