import { relayFetch } from "../decode/byte-relay.ts";
import { errorMessage, type MessageTarget } from "../decode/protocol.ts";
import {
  createDefaultPixelSourceRegistry,
  type PixelSourceRegistry,
} from "../pixel-source/registry.ts";
import { createPatchReader, type PatchReader } from "./patch-reader.ts";
import type { PatchReply, PatchRequest } from "./protocol.ts";

export type PatchWorkerScope = MessageTarget<PatchReply, PatchRequest>;

export function startPatchWorker(
  scope: PatchWorkerScope,
  registry: PixelSourceRegistry = createDefaultPixelSourceRegistry(),
): void {
  let opened: Promise<PatchReader> | null = null;

  const fail = (id: number | null, error: unknown) => {
    scope.postMessage({ type: "failed", id, message: errorMessage(error) }, []);
  };

  scope.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "open") {
      const cacheSize = message.cacheSize;
      opened = registry
        .open({ ...message.request, fetch: relayFetch(message.bytes) })
        .then((source) => createPatchReader(source, cacheSize === undefined ? {} : { cacheSize }));
      opened
        .then((reader) => reader.ready)
        .then(
          (info) => scope.postMessage({ type: "opened", info }, []),
          (error: unknown) => fail(null, error),
        );
      return;
    }
    const { id, query } = message;
    if (opened === null) {
      fail(id, new Error("The patch worker has not opened a slide"));
      return;
    }
    opened
      .then((reader) => reader.read(query))
      .then(
        (result) => {
          const rgb = result.patch.rgb?.slice() ?? null;
          scope.postMessage(
            { type: "patch", id, ...result, patch: { ...result.patch, rgb } },
            rgb ? [rgb.buffer] : [],
          );
        },
        (error: unknown) => fail(id, error),
      );
  });
}
