import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PAGE_HTML } from "#page.ts";
import { type PartPlan, partSizeFor, partsProblem, planParts } from "#part-size.ts";

export interface ListedPart {
  readonly partNumber: number;
  readonly size: number;
  readonly etag: string;
}

export type ApiEvent =
  | {
      readonly at: number;
      readonly kind: "create";
      readonly key: string;
      readonly uploadId: string;
    }
  | { readonly at: number; readonly kind: "sign"; readonly partNumber: number }
  | {
      readonly at: number;
      readonly kind: "list";
      readonly parts: number;
      readonly bytes: number;
      readonly pages: number;
    }
  | { readonly at: number; readonly kind: "complete"; readonly parts: readonly ListedPart[] }
  | { readonly at: number; readonly kind: "refuse"; readonly reason: string }
  | { readonly at: number; readonly kind: "abort"; readonly uploadId: string };

export interface UploadRecord {
  readonly key: string;
  readonly uploadId: string;
  readonly name: string;
  readonly fileBytes: number;
  readonly plan: PartPlan;
}

export interface UploadApiOptions {
  readonly s3: S3Client;
  readonly bucket: string;
  readonly publicS3Url: () => string;
  readonly keyPrefix: string;
  readonly partUrlExpirySeconds: number;
  readonly preferredPartBytes: number;
  readonly listPageSize: number;
  readonly port?: number;
}

export interface UploadApi {
  readonly url: string;
  readonly port: number;
  readonly events: ApiEvent[];
  readonly uploads: Map<string, UploadRecord>;
  close(): Promise<void>;
}

class HttpProblem extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const UPPY_BUNDLE = fileURLToPath(import.meta.resolve("uppy/dist/uppy.min.mjs"));
const MULTIPART = /^\/s3\/multipart(?:\/([^/]+))?(?:\/([^/]+))?$/;

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function sanitize(etag: string | undefined): string {
  return (etag ?? "").replaceAll('"', "");
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "upload";
}

export async function startUploadApi(options: UploadApiOptions): Promise<UploadApi> {
  const events: ApiEvent[] = [];
  const uploads = new Map<string, UploadRecord>();
  const uppyBundle = await readFile(UPPY_BUNDLE);
  const log = (event: ApiEvent) => events.push(event);

  const recordFor = (uploadId: string, key: string | null): UploadRecord => {
    const record = uploads.get(uploadId);
    if (!record || record.key !== key) {
      throw new HttpProblem(403, "this upload does not belong to the caller");
    }
    return record;
  };

  const listAllParts = async (record: UploadRecord): Promise<ListedPart[]> => {
    const parts: ListedPart[] = [];
    let marker: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await options.s3.send(
        new ListPartsCommand({
          Bucket: options.bucket,
          Key: record.key,
          UploadId: record.uploadId,
          MaxParts: options.listPageSize,
          PartNumberMarker: marker,
        }),
      );
      pages++;
      for (const part of page.Parts ?? []) {
        parts.push({
          partNumber: part.PartNumber ?? 0,
          size: part.Size ?? 0,
          etag: sanitize(part.ETag),
        });
      }
      if (!page.IsTruncated) {
        break;
      }
      marker = page.NextPartNumberMarker;
    }
    const bytes = parts.reduce((sum, part) => sum + part.size, 0);
    log({ at: performance.now(), kind: "list", parts: parts.length, bytes, pages });
    return parts;
  };

  const signPart = async (record: UploadRecord, partNumber: number): Promise<string> => {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > record.plan.partCount) {
      throw new HttpProblem(400, `part ${partNumber} is outside 1 to ${record.plan.partCount}`);
    }
    const signed = await getSignedUrl(
      options.s3,
      new UploadPartCommand({
        Bucket: options.bucket,
        Key: record.key,
        UploadId: record.uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: options.partUrlExpirySeconds },
    );
    log({ at: performance.now(), kind: "sign", partNumber });
    const url = new URL(signed);
    const publicUrl = new URL(options.publicS3Url());
    url.protocol = publicUrl.protocol;
    url.host = publicUrl.host;
    return url.toString();
  };

  const multipart = async (
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    uploadId: string | undefined,
    action: string | undefined,
  ): Promise<void> => {
    const key = url.searchParams.get("key");
    if (request.method === "POST" && uploadId === undefined) {
      const body = (await readJson(request)) as {
        filename?: string;
        type?: string;
        metadata?: Record<string, unknown>;
      };
      const fileBytes = Number(body.metadata?.size);
      const plan = planParts(fileBytes, partSizeFor(fileBytes, options.preferredPartBytes));
      const objectKey = `${options.keyPrefix}${randomUUID()}/${safeName(body.filename ?? "")}`;
      const created = await options.s3.send(
        new CreateMultipartUploadCommand({
          Bucket: options.bucket,
          Key: objectKey,
          ContentType: "application/octet-stream",
        }),
      );
      const record: UploadRecord = {
        key: objectKey,
        uploadId: created.UploadId ?? "",
        name: body.filename ?? "",
        fileBytes,
        plan,
      };
      uploads.set(record.uploadId, record);
      log({ at: performance.now(), kind: "create", key: record.key, uploadId: record.uploadId });
      send(response, 200, { key: record.key, uploadId: record.uploadId });
      return;
    }
    if (uploadId === undefined) {
      throw new HttpProblem(404, "no such route");
    }
    const record = recordFor(decodeURIComponent(uploadId), key);
    if (request.method === "GET" && action === undefined) {
      const parts = await listAllParts(record);
      send(
        response,
        200,
        parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag, Size: part.size })),
      );
      return;
    }
    if (request.method === "GET" && action !== undefined) {
      send(response, 200, { url: await signPart(record, Number(action)) });
      return;
    }
    if (request.method === "POST" && action === "complete") {
      const body = (await readJson(request)) as { parts?: { PartNumber: number; ETag: string }[] };
      const stored = await listAllParts(record);
      const problem = partsProblem(stored, record.fileBytes, record.plan.partBytes);
      const claimed = new Map((body.parts ?? []).map((part) => [part.PartNumber, part.ETag]));
      const mismatch = stored.find((part) => claimed.get(part.partNumber) !== part.etag);
      const reason = problem ?? (mismatch ? `part ${mismatch.partNumber} has another ETag` : null);
      if (reason !== null) {
        log({ at: performance.now(), kind: "refuse", reason });
        throw new HttpProblem(400, reason);
      }
      await options.s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: options.bucket,
          Key: record.key,
          UploadId: record.uploadId,
          MultipartUpload: {
            Parts: stored.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
          },
        }),
      );
      uploads.delete(record.uploadId);
      log({ at: performance.now(), kind: "complete", parts: stored });
      send(response, 200, { location: `s3://${options.bucket}/${record.key}`, key: record.key });
      return;
    }
    if (request.method === "DELETE" && action === undefined) {
      await options.s3.send(
        new AbortMultipartUploadCommand({
          Bucket: options.bucket,
          Key: record.key,
          UploadId: record.uploadId,
        }),
      );
      uploads.delete(record.uploadId);
      log({ at: performance.now(), kind: "abort", uploadId: record.uploadId });
      send(response, 200, {});
      return;
    }
    throw new HttpProblem(405, "method not allowed");
  };

  const route = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://api");
    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      response.end(PAGE_HTML);
      return;
    }
    if (url.pathname === "/uppy.min.mjs") {
      response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
      response.end(uppyBundle);
      return;
    }
    if (url.pathname === "/uploads/open") {
      const name = url.searchParams.get("name");
      const fileBytes = Number(url.searchParams.get("size"));
      const open = [...uploads.values()].find(
        (record) => record.name === name && record.fileBytes === fileBytes,
      );
      send(response, open ? 200 : 404, open ? { key: open.key, uploadId: open.uploadId } : {});
      return;
    }
    const match = MULTIPART.exec(url.pathname);
    if (match) {
      await multipart(request, response, url, match[1], match[2]);
      return;
    }
    throw new HttpProblem(404, "no such route");
  };

  const server = createServer((request, response) => {
    route(request, response).catch((error: unknown) => {
      const status = error instanceof HttpProblem ? error.status : 500;
      if (!response.headersSent) {
        send(response, status, { detail: error instanceof Error ? error.message : String(error) });
      } else {
        response.destroy();
      }
    });
  });
  server.keepAliveTimeout = 30_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    events,
    uploads,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
