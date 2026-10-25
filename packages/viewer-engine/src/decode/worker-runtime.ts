import {
  createDefaultPixelSourceRegistry,
  type PixelSourceRegistry,
} from "../pixel-source/registry.ts";
import type { PixelSource } from "../pixel-source/types.ts";
import { readVivRegion } from "../viv/viv-levels.ts";
import { relayFetch } from "./byte-relay.ts";
import {
  type DecodeReply,
  type DecodeRequest,
  errorMessage,
  type MessageTarget,
} from "./protocol.ts";

export type DecodeWorkerScope = MessageTarget<DecodeReply, DecodeRequest>;

export function startDecodeWorker(
  scope: DecodeWorkerScope,
  registry: PixelSourceRegistry = createDefaultPixelSourceRegistry(),
): void {
  let opened: Promise<PixelSource> | null = null;

  const fail = (id: number | null, error: unknown) => {
    scope.postMessage({ type: "failed", id, message: errorMessage(error) }, []);
  };

  scope.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "open") {
      opened = registry.open({ ...message.request, fetch: relayFetch(message.bytes) });
      opened
        .then((source) => (source.decodeReport ? source.decodeReport() : null))
        .then(
          (report) => scope.postMessage({ type: "opened", report }, []),
          (error: unknown) => fail(null, error),
        );
      return;
    }
    const { id, region } = message;
    if (opened === null) {
      fail(id, new Error("The decode worker has not opened a slide"));
      return;
    }
    opened
      .then((source) => readVivRegion(source, region))
      .then(
        (tile) => scope.postMessage({ type: "tile", id, ...tile }, [tile.data.buffer]),
        (error: unknown) => fail(id, error),
      );
  });
}
