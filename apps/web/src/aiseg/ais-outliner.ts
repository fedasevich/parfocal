import type { SamFrame } from "@parfocal/viewer-engine/sam-prompt";
import type { AisInstance } from "./ais-instances.ts";
import type { AisReply, AisRequest } from "./ais-worker.ts";

export interface AisOutliner {
  readonly outline: (maps: Float32Array, width: number, height: number) => Promise<AisInstance[]>;
  readonly pixels: (rgb: Uint8Array, frame: SamFrame) => Promise<Float32Array<ArrayBuffer>>;
  readonly close: () => void;
}

type Answer = AisInstance[] | Float32Array;

interface Waiting {
  readonly resolve: (answer: Answer) => void;
  readonly reject: (error: Error) => void;
}

function ownBuffer(maps: Float32Array): Float32Array {
  const whole = maps.byteOffset === 0 && maps.byteLength === maps.buffer.byteLength;
  return whole ? maps : maps.slice();
}

function geometryOnly(frame: SamFrame): SamFrame {
  const { x, y, width, height, downsample } = frame.patch;
  return {
    patch: { x, y, width, height, downsample },
    scale: frame.scale,
    fittedWidth: frame.fittedWidth,
    fittedHeight: frame.fittedHeight,
  };
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
      else entry.resolve("pixels" in reply ? reply.pixels : reply.instances);
    };
    created.onerror = () => failAll(new Error("The outline worker stopped"));
    return created;
  };

  const send = (build: (id: number) => AisRequest, buffer: ArrayBufferLike): Promise<Answer> => {
    worker ??= start();
    const id = ++next;
    const request = build(id);
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      worker?.postMessage(request, [buffer]);
    });
  };

  return {
    outline(maps, width, height) {
      const owned = ownBuffer(maps);
      const answer = send(
        (id) => ({ id, kind: "outline", maps: owned, width, height }),
        owned.buffer,
      );
      return answer as Promise<AisInstance[]>;
    },
    pixels(rgb, frame) {
      const owned = rgb.slice();
      const answer = send(
        (id) => ({ id, kind: "pixels", rgb: owned, frame: geometryOnly(frame) }),
        owned.buffer,
      );
      return answer as Promise<Float32Array<ArrayBuffer>>;
    },
    close() {
      worker?.terminate();
      worker = null;
      failAll(new Error("The outline worker was closed"));
    },
  };
}
