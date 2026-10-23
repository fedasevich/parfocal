import type { ByteReply, ByteRequest, MessageTarget } from "./protocol.ts";
import { errorMessage } from "./protocol.ts";
import type { RangeCache, RangeReply } from "./range-cache.ts";

export interface BytePort extends MessageTarget<unknown, unknown> {
  start?(): void;
  close?(): void;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestRange(input: RequestInfo | URL, init?: RequestInit): string | null {
  const headers = new Headers(
    init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined),
  );
  return headers.get("range");
}

function toResponse(reply: Omit<RangeReply, "bytes"> & { bytes: Uint8Array<ArrayBuffer> }) {
  const headers = new Headers();
  if (reply.contentRange !== null) headers.set("content-range", reply.contentRange);
  const empty = reply.status === 204 || reply.status === 304;
  return new Response(empty ? null : reply.bytes, { status: reply.status, headers });
}

export function cachedFetch(cache: RangeCache): typeof globalThis.fetch {
  return async (input, init) =>
    toResponse(await cache.get(requestUrl(input), requestRange(input, init)));
}

export function relayFetch(port: BytePort): typeof globalThis.fetch {
  const waiting = new Map<
    number,
    { resolve: (response: Response) => void; reject: (error: Error) => void }
  >();
  let next = 0;
  port.addEventListener("message", (event) => {
    const reply = event.data as ByteReply;
    const waiter = waiting.get(reply.id);
    if (waiter === undefined) return;
    waiting.delete(reply.id);
    if ("error" in reply) {
      waiter.reject(new Error(reply.error));
      return;
    }
    waiter.resolve(toResponse(reply));
  });
  port.start?.();
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      const request: ByteRequest = {
        id,
        url: requestUrl(input),
        range: requestRange(input, init),
      };
      port.postMessage(request, []);
    });
}

export function serveBytes(port: BytePort, cache: RangeCache): void {
  port.addEventListener("message", (event) => {
    const request = event.data as ByteRequest;
    cache.get(request.url, request.range).then(
      (reply) => {
        const message: ByteReply = { id: request.id, ...reply };
        port.postMessage(message, [reply.bytes.buffer]);
      },
      (error: unknown) => {
        const message: ByteReply = { id: request.id, error: errorMessage(error) };
        port.postMessage(message, []);
      },
    );
  });
  port.start?.();
}
