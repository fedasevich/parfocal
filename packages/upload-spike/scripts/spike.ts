import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetBucketLifecycleConfigurationCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type LifecycleRule,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
  UploadPartCommand,
  UploadPartCopyCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type LatencyProxy, startLatencyProxy } from "@parfocal/latency-proxy";
import { chromium, type Page } from "@playwright/test";
import { digestFile, type FileDigest, sha256OfStream, writeRandomFile } from "../src/digest.ts";
import { MINIO_CREDENTIALS, MINIO_IMAGE, startMinio, stopMinio } from "../src/minio.ts";
import { MIB, partSizeFor, planParts } from "../src/part-size.ts";
import { type ApiEvent, startUploadApi, type UploadApi } from "../src/upload-api.ts";

const CONTAINER = "parfocal-stack039-minio";
const SETTLE_MS = 1000;
const R2_BUCKET = "parfocal-dev";
const R2_APP_ORIGIN = "http://localhost:5173";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    target: { type: "string", default: "minio" },
    "env-file": { type: "string", default: resolve(import.meta.dirname, "../../../.env") },
    "app-origin": { type: "string" },
    "size-mib": { type: "string" },
    source: { type: "string" },
    "part-mib": { type: "string", default: "16" },
    "copy-part-mib": { type: "string", default: "300" },
    "rtt-ms": { type: "string" },
    "uplink-mbit": { type: "string" },
    "cut-at": { type: "string", default: "0.3" },
    "reload-at": { type: "string", default: "0.6" },
    "outage-s": { type: "string", default: "5" },
    "expiry-s": { type: "string", default: "300" },
    "list-page": { type: "string" },
    "minio-port": { type: "string", default: "9150" },
    "app-port": { type: "string", default: "9151" },
    "s3-port": { type: "string", default: "9152" },
    workdir: { type: "string", default: join(tmpdir(), "parfocal-upload-spike") },
    out: { type: "string" },
    "keep-file": { type: "boolean", default: false },
  },
});

if (args.target !== "minio" && args.target !== "r2") {
  throw new Error(`--target must be minio or r2, got ${args.target}`);
}
const r2 = args.target === "r2";
const sizeMib = args["size-mib"] ?? (r2 ? "1024" : "4096");
const sizeBytes = Number(sizeMib) * MIB;
const preferredPartBytes = Number(args["part-mib"]) * MIB;
const copyPartBytes = Number(args["copy-part-mib"]) * MIB;
const rttMs = Number(args["rtt-ms"] ?? (r2 ? "0" : "50"));
const uplinkMbit = Number(args["uplink-mbit"] ?? (r2 ? "0" : "200"));
const uplinkBytesPerSecond = uplinkMbit > 0 ? (uplinkMbit * 1_000_000) / 8 : null;
const listPageSize = Number(args["list-page"] ?? (r2 ? "25" : "100"));
const cutAt = Number(args["cut-at"]);
const reloadAt = Number(args["reload-at"]);
const outageMs = Number(args["outage-s"]) * 1000;
const minioPort = Number(args["minio-port"]);
const appPort = Number(args["app-port"]);
const s3Port = Number(args["s3-port"]);
const minioUrl = `http://127.0.0.1:${minioPort}`;
const s3PublicUrl = `http://127.0.0.1:${s3Port}`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set in ${args["env-file"]}`);
  }
  return value;
}

if (r2) {
  process.loadEnvFile(args["env-file"]);
}
const BUCKET = r2 ? requireEnv("R2_BUCKET") : "parfocal-spike";
if (r2 && BUCKET !== R2_BUCKET) {
  throw new Error(`the R2 run only touches ${R2_BUCKET}, but R2_BUCKET is ${BUCKET}`);
}
const runId = randomUUID().slice(0, 8);
const RUN_PREFIX = r2 ? `t/spike-${runId}/` : "t/spike-tenant/";
const KEY_PREFIX = `${RUN_PREFIX}quarantine/`;
const storageUrl = r2 ? requireEnv("R2_ENDPOINT").replace(/\/+$/, "") : minioUrl;
const appOrigin = args["app-origin"] ?? (r2 ? R2_APP_ORIGIN : `http://127.0.0.1:${appPort}`);
const appListenPort = Number(new URL(appOrigin).port || 80);

const s3 = new S3Client({
  endpoint: storageUrl,
  region: r2 ? "auto" : "us-east-1",
  forcePathStyle: true,
  credentials: r2
    ? {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      }
    : MINIO_CREDENTIALS,
  ...(r2
    ? { requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" }
    : {}),
});

const sdkOperations: Record<string, number> = {};
s3.middlewareStack.add(
  (next, context) => async (input) => {
    const name = context.commandName ?? "unknown";
    sdkOperations[name] = (sdkOperations[name] ?? 0) + 1;
    return next(input);
  },
  { step: "deserialize", name: "countStorageOperations" },
);

const directRequests: Record<string, number> = {};
function storageFetch(url: string, init: RequestInit): Promise<Response> {
  const method = init.method ?? "GET";
  directRequests[method] = (directRequests[method] ?? 0) + 1;
  return fetch(url, init);
}

function addCounts(into: Record<string, number>, from: Readonly<Record<string, number>>): void {
  for (const [name, count] of Object.entries(from)) {
    into[name] = (into[name] ?? 0) + count;
  }
}

function log(message: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
}

function startSpikeMinio(): Promise<string> {
  return startMinio({ container: CONTAINER, port: minioPort, corsOrigin: appOrigin });
}

function stopSpikeMinio(): Promise<void> {
  return stopMinio(CONTAINER);
}

interface PageState {
  readonly status: "idle" | "uploading" | "error" | "done";
  readonly bytesUploaded: number;
  readonly bytesTotal: number;
  readonly error: string | null;
  readonly errors: readonly string[];
  readonly partsUploaded: readonly number[];
  readonly result: { key: string; location: string } | null;
}

function pageState(page: Page): Promise<PageState> {
  return page.evaluate(() => (window as unknown as { spikeState: PageState }).spikeState);
}

async function startUpload(page: Page, file: string, partBytes: number, resume: boolean) {
  await page.goto(appOrigin);
  await page.setInputFiles("#file", file);
  return page.evaluate(
    (options) =>
      (
        window as unknown as {
          spikeUpload: (o: { partBytes: number; resume: boolean }) => Promise<unknown>;
        }
      ).spikeUpload(options),
    { partBytes, resume },
  );
}

class Network {
  app: LatencyProxy | null = null;
  s3: LatencyProxy | null = null;
  readonly storageMethods: Record<string, number> = {};
  private readonly api: UploadApi;

  constructor(api: UploadApi) {
    this.api = api;
  }

  async up(): Promise<void> {
    this.app = await startLatencyProxy({
      target: this.api.url,
      port: appListenPort,
      rttMs,
    });
    this.s3 = await startLatencyProxy({
      target: storageUrl,
      port: s3Port,
      rttMs,
      uplinkBytesPerSecond,
    });
  }

  async down(): Promise<void> {
    if (this.s3) {
      addCounts(this.storageMethods, this.s3.stats().methods);
    }
    await Promise.all([this.app?.close(), this.s3?.close()]);
    this.app = null;
    this.s3 = null;
  }

  storageRequests(): number {
    return this.s3?.stats().requests ?? 0;
  }

  uploaded(): number {
    return this.s3?.stats().uploadedBytes ?? 0;
  }
}

function eventsSince(api: UploadApi, index: number): ApiEvent[] {
  return api.events.slice(index);
}

function firstOf<K extends ApiEvent["kind"]>(
  events: readonly ApiEvent[],
  kind: K,
): Extract<ApiEvent, { kind: K }> | undefined {
  return events.find((event): event is Extract<ApiEvent, { kind: K }> => event.kind === kind);
}

async function waitFor(
  page: Page,
  done: (state: PageState) => boolean,
  timeoutMs: number,
  onTick?: (state: PageState) => void,
): Promise<PageState> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const state = await pageState(page);
    onTick?.(state);
    if (done(state)) {
      return state;
    }
    if (performance.now() > deadline) {
      throw new Error(`timed out in state ${JSON.stringify({ ...state, partsUploaded: [] })}`);
    }
    await sleep(100);
  }
}

interface PhaseReport {
  readonly name: string;
  readonly startedMs: number;
  readonly endedMs: number;
  readonly proxyBytes: number;
  readonly storageRequests: number;
  readonly partsListedAtStart: number;
  readonly bytesListedAtStart: number;
  readonly partsSigned: readonly number[];
  readonly resignedListedParts: readonly number[];
  readonly resumeToListMs: number | null;
  readonly resumeToFirstSignMs: number | null;
}

async function uploadWithInterruptions(
  api: UploadApi,
  network: Network,
  file: string,
  digest: FileDigest,
  partBytes: number,
) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  context.on("requestfailed", (request) => {
    const url = new URL(request.url());
    log(
      `browser ${request.method()} ${url.origin}${url.pathname} failed: ${request.failure()?.errorText}`,
    );
  });
  context.on("console", (message) => {
    if (message.type() === "error") {
      log(
        `browser console: ${message
          .text()
          .replace(/\?[^ ']*/, "?…")
          .slice(0, 400)}`,
      );
    }
  });
  let page = await context.newPage();
  const phases: PhaseReport[] = [];
  const started = performance.now();
  let listedParts = new Set<number>();
  let listedBytes = 0;

  const beginPhase = async (name: string, begin: () => Promise<void>) => {
    const eventIndex = api.events.length;
    const proxyAtStart = network.uploaded();
    const requestsAtStart = network.storageRequests();
    const startedMs = performance.now();
    const listedBefore = listedParts;
    await begin();
    const until = (stop: (sent: number) => boolean) =>
      waitFor(
        page,
        (state) => {
          if (state.status === "error") {
            throw new Error(`the upload failed in phase "${name}": ${state.error}`);
          }
          return state.status === "done" || stop(network.uploaded() - proxyAtStart);
        },
        3_600_000,
      );
    const finish = () => {
      const endedMs = performance.now();
      const events = eventsSince(api, eventIndex);
      const list = firstOf(events, "list");
      const sign = firstOf(events, "sign");
      const signed = events.flatMap((event) => (event.kind === "sign" ? [event.partNumber] : []));
      phases.push({
        name,
        startedMs: startedMs - started,
        endedMs: endedMs - started,
        proxyBytes: network.uploaded() - proxyAtStart,
        storageRequests: network.storageRequests() - requestsAtStart,
        partsListedAtStart: list ? list.parts : 0,
        bytesListedAtStart: list ? list.bytes : 0,
        partsSigned: signed,
        resignedListedParts: signed.filter((partNumber) => listedBefore.has(partNumber)),
        resumeToListMs: list ? list.at - startedMs : null,
        resumeToFirstSignMs: sign ? sign.at - startedMs : null,
      });
    };
    return { until, finish };
  };

  const markListed = async () => {
    const [record] = [...api.uploads.values()];
    if (!record) {
      return;
    }
    const listed = await s3.send(
      new ListPartsCommand({ Bucket: BUCKET, Key: record.key, UploadId: record.uploadId }),
    );
    const parts = listed.Parts ?? [];
    listedParts = new Set(parts.map((part) => part.PartNumber ?? 0));
    listedBytes = parts.reduce((sum, part) => sum + (part.Size ?? 0), 0);
  };

  await network.up();
  log(`uploading ${digest.bytes} bytes in ${planParts(digest.bytes, partBytes).partCount} parts`);
  const first = await beginPhase("first run until the link is cut", async () => {
    await startUpload(page, file, partBytes, false);
  });
  await first.until((sent) => sent >= cutAt * digest.bytes);
  first.finish();
  const cutAtMs = performance.now();
  await network.down();
  log(`link cut after ${phases[0]?.proxyBytes} bytes through the proxy`);
  const errored = await waitFor(page, (state) => state.status === "error", 120_000);
  const detectMs = performance.now() - cutAtMs;
  log(`Uppy reported "${errored.error}" after ${detectMs.toFixed(0)} ms`);
  await sleep(Math.max(0, outageMs - (performance.now() - cutAtMs)));
  await markListed();
  const listedAtRetry = { parts: listedParts.size, bytes: listedBytes };
  log(`${listedAtRetry.parts} parts stored when the link returns`);
  await network.up();

  const second = await beginPhase("after the link returns, until the page closes", async () => {
    await page.evaluate(() => (window as unknown as { spikeRetry: () => void }).spikeRetry());
  });
  const afterRetry = await second.until(
    (sent) => reloadAt > cutAt && listedAtRetry.bytes + sent >= reloadAt * digest.bytes,
  );
  let reloaded = false;
  if (afterRetry.status !== "done") {
    await page.close();
    await sleep(SETTLE_MS);
    second.finish();
    reloaded = true;
    page = await context.newPage();
    await markListed();
    log(`page closed mid-upload with ${listedParts.size} parts stored, opening it again`);
    const third = await beginPhase("after the page opens again, until done", async () => {
      await startUpload(page, file, partBytes, true);
    });
    await third.until(() => false);
    third.finish();
  } else {
    second.finish();
  }
  const final = await pageState(page);
  const totalMs = performance.now() - started;
  await browser.close();
  return { phases, detectMs, errors: errored.errors, final, totalMs, reloaded };
}

async function verifyObject(key: string, digest: FileDigest) {
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = object.Body as AsyncIterable<Uint8Array> | undefined;
  if (!body) {
    throw new Error("no object body");
  }
  const sha256 = await sha256OfStream(body);
  return {
    bytes: head.ContentLength ?? 0,
    etag: (head.ETag ?? "").replaceAll('"', ""),
    sha256,
    sha256Matches: sha256 === digest.sha256,
    etagMatches: (head.ETag ?? "").replaceAll('"', "") === digest.multipartEtag,
  };
}

async function putPart(url: string, bytes: number, origin = appOrigin) {
  const response = await storageFetch(url, {
    method: "PUT",
    body: new Uint8Array(bytes),
    headers: { origin },
  });
  const text = await response.text();
  return {
    status: response.status,
    etag: (response.headers.get("etag") ?? "").replaceAll('"', ""),
    code: /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? null,
    allowOrigin: response.headers.get("access-control-allow-origin"),
  };
}

async function apiJson(api: UploadApi, path: string, init?: RequestInit) {
  const response = await fetch(`${api.url}${path}`, init);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function createViaApi(api: UploadApi, name: string, size: number) {
  const created = await apiJson(api, "/s3/multipart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: name, type: "application/octet-stream", metadata: { size } }),
  });
  return created.body as { key: string; uploadId: string };
}

async function signViaApi(api: UploadApi, uploadId: string, key: string, partNumber: number) {
  const signed = await apiJson(
    api,
    `/s3/multipart/${encodeURIComponent(uploadId)}/${partNumber}?key=${encodeURIComponent(key)}`,
  );
  const url = typeof signed.body.url === "string" ? signed.body.url : "";
  return { status: signed.status, url: url.replace(s3PublicUrl, storageUrl) };
}

function storageError(error: unknown) {
  const failure = error as { name?: string; Code?: string; message?: string };
  return {
    code: failure.Code ?? failure.name ?? "unknown",
    message: (failure.message ?? String(error)).slice(0, 300),
  };
}

async function unevenParts(api: UploadApi) {
  const sizes = [16 * MIB, 15 * MIB, 9 * MIB + 3];
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const uneven = await createViaApi(api, "uneven.bin", total);
  const parts: { PartNumber: number; ETag: string }[] = [];
  for (const [index, size] of sizes.entries()) {
    const { url } = await signViaApi(api, uneven.uploadId, uneven.key, index + 1);
    const put = await putPart(url, size);
    parts.push({ PartNumber: index + 1, ETag: put.etag });
  }
  const refused = await apiJson(
    api,
    `/s3/multipart/${encodeURIComponent(uneven.uploadId)}/complete?key=${encodeURIComponent(uneven.key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parts }),
    },
  );
  let storage: { accepted: boolean; code: string | null; message: string | null };
  try {
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: BUCKET,
        Key: uneven.key,
        UploadId: uneven.uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
    storage = { accepted: true, code: null, message: null };
  } catch (error) {
    storage = { accepted: false, ...storageError(error) };
    await s3.send(
      new AbortMultipartUploadCommand({
        Bucket: BUCKET,
        Key: uneven.key,
        UploadId: uneven.uploadId,
      }),
    );
  }
  api.uploads.delete(uneven.uploadId);
  return { sizes, apiStatus: refused.status, apiReason: refused.body.detail, storage };
}

async function presignedPost() {
  const url = await getSignedUrl(
    s3,
    new CreateMultipartUploadCommand({
      Bucket: BUCKET,
      Key: `${KEY_PREFIX}presigned-post/probe.bin`,
    }),
    { expiresIn: 60 },
  );
  const response = await storageFetch(url, { method: "POST", headers: { origin: appOrigin } });
  const text = await response.text();
  return {
    status: response.status,
    code: /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? null,
    createdUpload: /<UploadId>/.test(text),
  };
}

async function partChecksums(declared: boolean) {
  const key = `${KEY_PREFIX}checksum/${declared ? "declared" : "plain"}.bin`;
  const created = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      ...(declared ? { ChecksumAlgorithm: "SHA256" as const } : {}),
    }),
  );
  const body = randomBytes(5 * MIB);
  const correct = createHash("sha256").update(body).digest("base64");
  const wrong = createHash("sha256").update("another body").digest("base64");
  const send = async (partNumber: number, checksum: string) => {
    try {
      const reply = await s3.send(
        new UploadPartCommand({
          Bucket: BUCKET,
          Key: key,
          UploadId: created.UploadId,
          PartNumber: partNumber,
          Body: body,
          ChecksumSHA256: checksum,
        }),
      );
      return { accepted: true, echoed: reply.ChecksumSHA256 === checksum, error: null };
    } catch (error) {
      return { accepted: false, echoed: false, error: storageError(error) };
    }
  };
  const withCorrect = await send(1, correct);
  const withWrong = await send(2, wrong);
  const listed = await s3.send(
    new ListPartsCommand({ Bucket: BUCKET, Key: key, UploadId: created.UploadId }),
  );
  await s3.send(
    new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: created.UploadId }),
  );
  return {
    algorithmDeclaredAtCreate: declared,
    withCorrect,
    withWrong,
    listedChecksums: (listed.Parts ?? []).map((part) => part.ChecksumSHA256 ?? null),
  };
}

async function rangedCopy(file: string, sourceKey: string, sourceBytes: number) {
  const key = `${RUN_PREFIX}s/copy/original.bin`;
  const plan = planParts(sourceBytes, copyPartBytes);
  const expected = await digestFile(file, copyPartBytes);
  const created = await s3.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key }));
  const parts: { PartNumber: number; ETag: string }[] = [];
  const started = performance.now();
  for (let index = 0; index < plan.partCount; index++) {
    const start = index * copyPartBytes;
    const end = Math.min(sourceBytes, start + copyPartBytes) - 1;
    const copied = await s3.send(
      new UploadPartCopyCommand({
        Bucket: BUCKET,
        Key: key,
        UploadId: created.UploadId,
        PartNumber: index + 1,
        CopySource: `${BUCKET}/${sourceKey}`,
        CopySourceRange: `bytes=${start}-${end}`,
      }),
    );
    parts.push({
      PartNumber: index + 1,
      ETag: (copied.CopyPartResult?.ETag ?? "").replaceAll('"', ""),
    });
  }
  const copyMs = performance.now() - started;
  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: created.UploadId,
      MultipartUpload: { Parts: parts },
    }),
  );
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  const etag = (head.ETag ?? "").replaceAll('"', "");
  return {
    partBytes: copyPartBytes,
    parts: plan.partCount,
    copyMs,
    bytes: head.ContentLength ?? 0,
    sizeMatches: head.ContentLength === sourceBytes,
    partEtagsAreRangeMd5: parts.every((part, index) => part.ETag === expected.partMd5[index]),
    objectEtagMatches: etag === expected.multipartEtag,
  };
}

async function cloudflareBucketSetting(setting: "cors" | "lifecycle") {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.R2_ACCOUNT_ID;
  if (!token || !account) {
    return { status: null, result: null };
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${BUCKET}/${setting}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const body = (await response.json()) as { result?: unknown };
  return { status: response.status, result: body.result ?? null };
}

async function minioLifecycle() {
  const lifecycleRule = async (rule: LifecycleRule) => {
    try {
      await s3.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: BUCKET,
          LifecycleConfiguration: { Rules: [rule] },
        }),
      );
      const read = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: BUCKET }));
      return { accepted: true, rules: read.Rules };
    } catch (error) {
      return { accepted: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  return {
    abortIncomplete: await lifecycleRule({
      ID: "abort-stale-quarantine-uploads",
      Status: "Enabled",
      Filter: { Prefix: KEY_PREFIX },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
    }),
    expireObjects: await lifecycleRule({
      ID: "expire-quarantine-objects",
      Status: "Enabled",
      Filter: { Prefix: KEY_PREFIX },
      Expiration: { Days: 7 },
    }),
  };
}

async function protocolChecks(
  api: UploadApi,
  file: string,
  sourceKey: string,
  sourceBytes: number,
) {
  const nonUniform = await unevenParts(api);

  const wrongTenant = await createViaApi(api, "other-tenant.bin", 6 * MIB);
  const forged = await signViaApi(api, wrongTenant.uploadId, `${KEY_PREFIX}someone-else`, 1);

  const expiryKey = `${KEY_PREFIX}expiry/probe.bin`;
  const expiring = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: expiryKey }),
  );
  const partCommand = () =>
    new UploadPartCommand({
      Bucket: BUCKET,
      Key: expiryKey,
      UploadId: expiring.UploadId,
      PartNumber: 1,
    });
  const shortUrl = await getSignedUrl(s3, partCommand(), { expiresIn: 2 });
  await sleep(3500);
  const expired = await putPart(shortUrl, MIB);
  const freshUrl = await getSignedUrl(s3, partCommand(), { expiresIn: 60 });
  const resigned = await putPart(freshUrl, MIB);
  await s3.send(
    new AbortMultipartUploadCommand({
      Bucket: BUCKET,
      Key: expiryKey,
      UploadId: expiring.UploadId,
    }),
  );

  const abandoned = await createViaApi(api, "abandoned.bin", 6 * MIB);
  const abandonedPart = await signViaApi(api, abandoned.uploadId, abandoned.key, 1);
  await putPart(abandonedPart.url, 6 * MIB);
  const before = await s3.send(
    new ListMultipartUploadsCommand({ Bucket: BUCKET, Prefix: abandoned.key }),
  );
  const aborted = await apiJson(
    api,
    `/s3/multipart/${encodeURIComponent(abandoned.uploadId)}?key=${encodeURIComponent(abandoned.key)}`,
    { method: "DELETE" },
  );
  const after = await s3.send(
    new ListMultipartUploadsCommand({ Bucket: BUCKET, Prefix: abandoned.key }),
  );
  await apiJson(
    api,
    `/s3/multipart/${encodeURIComponent(wrongTenant.uploadId)}?key=${encodeURIComponent(wrongTenant.key)}`,
    { method: "DELETE" },
  );

  const preflight = async (origin: string) => {
    const response = await storageFetch(
      `${storageUrl}/${BUCKET}/${KEY_PREFIX}x?partNumber=1&uploadId=x`,
      {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "PUT",
          "access-control-request-headers": "content-type",
        },
      },
    );
    await response.arrayBuffer();
    return {
      status: response.status,
      allowOrigin: response.headers.get("access-control-allow-origin"),
      allowMethods: response.headers.get("access-control-allow-methods"),
    };
  };
  const putFromApp = await (async () => {
    const probe = await createViaApi(api, "cors.bin", 5 * MIB);
    const { url } = await signViaApi(api, probe.uploadId, probe.key, 1);
    const response = await storageFetch(url, {
      method: "PUT",
      body: new Uint8Array(MIB),
      headers: { origin: appOrigin },
    });
    await response.arrayBuffer();
    await apiJson(
      api,
      `/s3/multipart/${encodeURIComponent(probe.uploadId)}?key=${encodeURIComponent(probe.key)}`,
      { method: "DELETE" },
    );
    return {
      status: response.status,
      allowOrigin: response.headers.get("access-control-allow-origin"),
      exposeHeaders: response.headers.get("access-control-expose-headers"),
      etagPresent: response.headers.has("etag"),
    };
  })();

  return {
    nonUniform,
    wrongKey: { status: forged.status },
    expiry: { expired, resigned },
    abort: {
      uploadsBefore: before.Uploads?.length ?? 0,
      apiStatus: aborted.status,
      uploadsAfter: after.Uploads?.length ?? 0,
    },
    cors: {
      preflightApp: await preflight(appOrigin),
      preflightOther: await preflight("http://evil.example"),
      putFromApp,
    },
    presignedPost: await presignedPost(),
    checksums: [await partChecksums(false), await partChecksums(true)],
    copy: await rangedCopy(file, sourceKey, sourceBytes),
    lifecycle: r2
      ? {
          lifecycle: await cloudflareBucketSetting("lifecycle"),
          cors: await cloudflareBucketSetting("cors"),
        }
      : await minioLifecycle(),
  };
}

async function cleanRunPrefix() {
  let abortedUploads = 0;
  let deletedObjects = 0;
  for (let round = 0; round < 20; round++) {
    const open = await s3.send(
      new ListMultipartUploadsCommand({ Bucket: BUCKET, Prefix: RUN_PREFIX }),
    );
    const uploads = open.Uploads ?? [];
    for (const upload of uploads) {
      await s3.send(
        new AbortMultipartUploadCommand({
          Bucket: BUCKET,
          Key: upload.Key,
          UploadId: upload.UploadId,
        }),
      );
      abortedUploads++;
    }
    const objects = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: RUN_PREFIX }));
    const contents = objects.Contents ?? [];
    for (const object of contents) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: object.Key }));
      deletedObjects++;
    }
    if (uploads.length === 0 && contents.length === 0) {
      return { prefix: RUN_PREFIX, abortedUploads, deletedObjects, leftOver: 0 };
    }
  }
  return { prefix: RUN_PREFIX, abortedUploads, deletedObjects, leftOver: -1 };
}

function lifecycleRuleApplied(setting: unknown): boolean {
  const rules = (setting as { rules?: unknown[] } | null)?.rules ?? [];
  return rules.some((rule) => {
    const typed = rule as {
      enabled?: boolean;
      conditions?: { prefix?: string };
      abortMultipartUploadsTransition?: { condition?: { maxAge?: number } };
    };
    return (
      typed.enabled === true &&
      typed.conditions?.prefix === "t/" &&
      typed.abortMultipartUploadsTransition?.condition?.maxAge === 86400
    );
  });
}

async function main(): Promise<void> {
  await mkdir(args.workdir, { recursive: true });
  const file = args.source ?? join(args.workdir, `synthetic-${sizeMib}mib.bin`);
  const synthetic = args.source === undefined;
  let api: UploadApi | null = null;
  let network: Network | null = null;
  let cleanup: Awaited<ReturnType<typeof cleanRunPrefix>> | null = null;
  try {
    if (r2) {
      log(`R2 bucket ${BUCKET}, run prefix ${RUN_PREFIX}, page origin ${appOrigin}`);
    } else {
      const minioVersion = await startSpikeMinio();
      log(`MinIO ${minioVersion} on ${minioUrl}`);
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    }
    if (synthetic) {
      log(`writing ${sizeBytes} random bytes to ${file}`);
      const writeStarted = performance.now();
      await writeRandomFile(file, sizeBytes);
      log(`written in ${((performance.now() - writeStarted) / 1000).toFixed(1)} s`);
    }
    const fileBytes = (await stat(file)).size;
    const partBytes = partSizeFor(fileBytes, preferredPartBytes);
    const plan = planParts(fileBytes, partBytes);
    const digestStarted = performance.now();
    const digest = await digestFile(file, partBytes);
    log(
      `source SHA-256 ${digest.sha256} in ${((performance.now() - digestStarted) / 1000).toFixed(1)} s`,
    );

    api = await startUploadApi({
      s3,
      bucket: BUCKET,
      publicS3Url: () => s3PublicUrl,
      keyPrefix: KEY_PREFIX,
      partUrlExpirySeconds: Number(args["expiry-s"]),
      preferredPartBytes,
      listPageSize,
    });
    network = new Network(api);
    const upload = await uploadWithInterruptions(api, network, file, digest, partBytes);
    await network.down();
    const completed = api.events.find((event) => event.kind === "complete");
    if (upload.final.status !== "done" || !upload.final.result || completed?.kind !== "complete") {
      throw new Error(`upload did not finish: ${JSON.stringify(upload.final.errors)}`);
    }
    const nonLastSizes = new Set(completed.parts.slice(0, -1).map((part) => part.size));
    const partEtagsMatch = completed.parts.every(
      (part, index) => part.etag === digest.partMd5[index],
    );
    const verification = await verifyObject(upload.final.result.key, digest);
    log(`object SHA-256 ${verification.sha256}`);
    const checks = await protocolChecks(api, file, upload.final.result.key, fileBytes);
    if (r2) {
      cleanup = await cleanRunPrefix();
      log(`run prefix cleaned: ${JSON.stringify(cleanup)}`);
    }

    const resentBytes = upload.phases.map((phase, index) => {
      const nextListed = upload.phases[index + 1]?.bytesListedAtStart ?? fileBytes;
      return phase.proxyBytes - (nextListed - phase.bytesListedAtStart);
    });
    const listPages = api.events.flatMap((event) => (event.kind === "list" ? [event.pages] : []));
    const report = {
      target: args.target,
      file: synthetic ? `synthetic random file of ${fileBytes} bytes` : basename(file),
      fileBytes,
      partBytes,
      partCount: plan.partCount,
      lastPartBytes: plan.lastPartBytes,
      network: { rttMs, uplinkBytesPerSecond, cutAt, reloadAt, outageMs },
      storage: r2
        ? { bucket: BUCKET, runPrefix: RUN_PREFIX, appOrigin }
        : { minioImage: MINIO_IMAGE },
      upload: {
        totalMs: upload.totalMs,
        detectMs: upload.detectMs,
        errors: upload.errors,
        reloaded: upload.reloaded,
        phases: upload.phases.map((phase, index) => ({
          ...phase,
          partsSigned: phase.partsSigned.length,
          firstPartSigned: phase.partsSigned[0] ?? null,
          resentBytes: resentBytes[index],
          throughputBytesPerSecond:
            phase.proxyBytes /
            ((phase.endedMs - phase.startedMs - (phase.resumeToFirstSignMs ?? 0)) / 1000),
        })),
        totalProxyBytes: upload.phases.reduce((sum, phase) => sum + phase.proxyBytes, 0),
      },
      parts: {
        stored: completed.parts.length,
        nonLastPartsAllOneSize: nonLastSizes.size <= 1,
        nonLastSize: [...nonLastSizes][0] ?? null,
        partEtagsAreSourceMd5: partEtagsMatch,
        listPageSize,
        listPages,
      },
      verification,
      checks,
      operations: {
        sdk: sdkOperations,
        browserThroughProxy: network.storageMethods,
        direct: directRequests,
      },
      cleanup,
    };
    const json = JSON.stringify(report, null, 2);
    if (args.out) {
      await writeFile(args.out, `${json}\n`);
    }
    console.log(json);
    const unevenRefusal = `${checks.nonUniform.storage.code} ${checks.nonUniform.storage.message}`;
    const r2Lifecycle = "lifecycle" in checks.lifecycle ? checks.lifecycle.lifecycle.result : null;
    const failures = [
      !verification.sha256Matches && "object SHA-256 differs from the source",
      !verification.etagMatches && "object ETag is not the multipart ETag of the source parts",
      !report.parts.nonLastPartsAllOneSize && "parts other than the last differ in size",
      !partEtagsMatch && "a part ETag is not the MD5 of the source part",
      completed.parts.length !== plan.partCount && "the object has the wrong number of parts",
      upload.phases.some((phase) => phase.resignedListedParts.length > 0) &&
        "a part listed as stored was sent again",
      resentBytes.some(
        (bytes, index) => (bytes ?? 0) > partBytes * (index < upload.phases.length - 1 ? 1 : 0),
      ) && "more than one part was resent at an interruption",
      checks.nonUniform.apiStatus !== 400 && "the API completed an upload with uneven parts",
      plan.partCount > listPageSize &&
        Math.max(0, ...listPages) < 2 &&
        "ListParts never needed a second page",
      !checks.copy.sizeMatches && "the ranged copy has another size than the source",
      !checks.copy.partEtagsAreRangeMd5 && "a copied part ETag is not the MD5 of its range",
      r2 &&
        (checks.nonUniform.storage.accepted || !/10048|InvalidPart/.test(unevenRefusal)) &&
        "R2 did not refuse uneven parts with 10048",
      r2 &&
        (checks.expiry.expired.status !== 403 || checks.expiry.expired.allowOrigin !== null) &&
        "an expired R2 part URL did not answer 403 without CORS headers",
      r2 && checks.cors.preflightApp.allowOrigin !== appOrigin && "R2 refused the app origin",
      r2 && checks.cors.preflightOther.allowOrigin !== null && "R2 allowed another origin",
      r2 &&
        !(checks.cors.putFromApp.exposeHeaders ?? "").toLowerCase().includes("etag") &&
        "R2 did not expose the ETag to the app origin",
      r2 && !lifecycleRuleApplied(r2Lifecycle) && "the abort-incomplete lifecycle rule is missing",
      r2 && cleanup?.leftOver !== 0 && "the run prefix was not emptied",
    ].filter(Boolean);
    if (failures.length > 0) {
      throw new Error(failures.join("; "));
    }
    log("all checks passed");
  } finally {
    await network?.down();
    await api?.close();
    if (r2 && cleanup === null) {
      cleanup = await cleanRunPrefix().catch((error: unknown) => {
        log(`cleanup failed, clean ${RUN_PREFIX} by hand: ${String(error)}`);
        return null;
      });
      log(`run prefix cleaned after a failure: ${JSON.stringify(cleanup)}`);
    }
    if (!r2) {
      await stopSpikeMinio();
    }
    if (synthetic && !args["keep-file"]) {
      await rm(file, { force: true });
    }
  }
}

await main();
