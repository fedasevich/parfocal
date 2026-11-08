import type { AisInstance } from "./ais-instances.ts";
import type { AisReply, AisRequest } from "./ais-worker.ts";

export interface AisOutliner {
  readonly outline: (maps: Float32Array, width: number, height: number) => Promise<AisInstance[]>;
  readonly close: () => void;
}

interface Waiting {
  readonly resolve: (instances: AisInstance[]) => void;
  readonly reject: (error: Error) => void;
}

function ownBuffer(maps: Float32Array): Float32Array {
  const whole = maps.byteOffset === 0 && maps.byteLength === maps.buffer.byteLength;
  return whole ? maps : maps.slice();
}

export function createAisOutliner(): AisOutliner {
  let worker: Worker | null = null;
  let next = 0;
  const waiting = new Map<number, Waiting>();

  const failAll = (error: Error) => {
    for (const entry of waiting.values()) entry.reject(error);
    waiting.clear();
  };

  const start = (): Worker => {
    const created = new Worker(new URL("./ais-worker.ts", import.meta.url), { type: "module" });
    created.onmessage = (event: MessageEvent<AisReply>) => {
      const reply = event.data;
      const entry = waiting.get(reply.id);
      if (entry === undefined) return;
      waiting.delete(reply.id);
      if ("error" in reply) entry.reject(new Error(reply.error));
      else entry.resolve(reply.instances);
    };
    created.onerror = () => failAll(new Error("The outline worker stopped"));
    return created;
  };

  return {
    outline(maps, width, height) {
      worker ??= start();
      const owned = ownBuffer(maps);
      const id = ++next;
      const request: AisRequest = { id, maps: owned, width, height };
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        worker?.postMessage(request, [owned.buffer]);
      });
    },
    close() {
      worker?.terminate();
      worker = null;
      failAll(new Error("The outline worker was closed"));
    },
  };
}
