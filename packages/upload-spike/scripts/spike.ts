import { execFile } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs, promisify } from "node:util";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  GetBucketLifecycleConfigurationCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type LifecycleRule,
  ListMultipartUploadsCommand,
  ListPartsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type LatencyProxy, startLatencyProxy } from "@parfocal/latency-proxy";
import { chromium, type Page } from "@playwright/test";
import { digestFile, type FileDigest, sha256OfStream, writeRandomFile } from "../src/digest.ts";
import { MIB, partSizeFor, planParts } from "../src/part-size.ts";
import { type ApiEvent, startUploadApi, type UploadApi } from "../src/upload-api.ts";

const run = promisify(execFile);

const MINIO_IMAGE =
  "pgsty/minio@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372";
const CONTAINER = "parfocal-stack039-minio";
const BUCKET = "parfocal-spike";
const KEY_PREFIX = "t/spike-tenant/quarantine/";
const SETTLE_MS = 1000;
const CREDENTIALS = { accessKeyId: "spike-access", secretAccessKey: "spike-secret-key-0000" };

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    "size-mib": { type: "string", default: "4096" },
    source: { type: "string" },
    "part-mib": { type: "string", default: "16" },
    "rtt-ms": { type: "string", default: "50" },
    "uplink-mbit": { type: "string", default: "200" },
    "cut-at": { type: "string", default: "0.3" },
    "reload-at": { type: "string", default: "0.6" },
    "outage-s": { type: "string", default: "5" },
    "expiry-s": { type: "string", default: "300" },
    "list-page": { type: "string", default: "100" },
    "minio-port": { type: "string", default: "9150" },
    "app-port": { type: "string", default: "9151" },
    "s3-port": { type: "string", default: "9152" },
    workdir: { type: "string", default: join(tmpdir(), "parfocal-upload-spike") },
    out: { type: "string" },
    "keep-file": { type: "boolean", default: false },
  },
});

const sizeBytes = Number(args["size-mib"]) * MIB;
const preferredPartBytes = Number(args["part-mib"]) * MIB;
const rttMs = Number(args["rtt-ms"]);
const uplinkBytesPerSecond = (Number(args["uplink-mbit"]) * 1_000_000) / 8;
const cutAt = Number(args["cut-at"]);
const reloadAt = Number(args["reload-at"]);
const outageMs = Number(args["outage-s"]) * 1000;
const minioPort = Number(args["minio-port"]);
const appPort = Number(args["app-port"]);
const s3Port = Number(args["s3-port"]);
const minioUrl = `http://127.0.0.1:${minioPort}`;
const appOrigin = `http://127.0.0.1:${appPort}`;
const s3PublicUrl = `http://127.0.0.1:${s3Port}`;

const s3 = new S3Client({
  endpoint: minioUrl,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: CREDENTIALS,
});

function log(message: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
}

async function docker(...command: string[]): Promise<string> {
  const { stdout } = await run("docker", command);
  return stdout.trim();
}

async function startMinio(): Promise<string> {
  await docker("rm", "-f", "-v", CONTAINER).catch(() => "");
  await docker(
    "run",
    "-d",
    "--rm",
    "--name",
    CONTAINER,
    "-p",
    `127.0.0.1:${minioPort}:9000`,
    "-e",
    `MINIO_ROOT_USER=${CREDENTIALS.accessKeyId}`,
    "-e",
    `MINIO_ROOT_PASSWORD=${CREDENTIALS.secretAccessKey}`,
    "-e",
    `MINIO_API_CORS_ALLOW_ORIGIN=${appOrigin}`,
    MINIO_IMAGE,
    "server",
    "/data",
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${minioUrl}/minio/health/live`);
      if (response.ok) {
        return (await docker("exec", CONTAINER, "minio", "--version")).split("\n")[0] ?? "";
      }
    } catch {}
    await sleep(200);
  }
  throw new Error("MinIO did not become healthy");
}

async function stopMinio(): Promise<void> {
  await docker("rm", "-f", "-v", CONTAINER).catch(() => "");
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
  private readonly api: UploadApi;

  constructor(api: UploadApi) {
    this.api = api;
  }

  async up(): Promise<void> {
    this.app = await startLatencyProxy({
      target: this.api.url,
      port: appPort,
      rttMs,
    });
    this.s3 = await startLatencyProxy({
      target: minioUrl,
      port: s3Port,
      rttMs,
      uplinkBytesPerSecond,
    });
  }

  async down(): Promise<void> {
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
        (state) => state.status === "done" || stop(network.uploaded() - proxyAtStart),
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
  const response = await fetch(url, {
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
  return { status: signed.status, url: url.replace(s3PublicUrl, minioUrl) };
}

async function protocolChecks(api: UploadApi) {
  const nonUniformSizes = [16 * MIB, 15 * MIB, 9 * MIB + 3];
  const nonUniformTotal = nonUniformSizes.reduce((sum, size) => sum + size, 0);
  const uneven = await createViaApi(api, "uneven.bin", nonUniformTotal);
  const parts: { PartNumber: number; ETag: string }[] = [];
  for (const [index, size] of nonUniformSizes.entries()) {
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
  let minioAcceptedUneven = false;
  try {
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: BUCKET,
        Key: uneven.key,
        UploadId: uneven.uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
    minioAcceptedUneven = true;
  } catch {
    minioAcceptedUneven = false;
  }
  api.uploads.delete(uneven.uploadId);

  const wrongTenant = await createViaApi(api, "other-tenant.bin", 6 * MIB);
  const forged = await signViaApi(api, wrongTenant.uploadId, `${KEY_PREFIX}someone-else`, 1);

  const expiring = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: `${KEY_PREFIX}expiry/probe.bin` }),
  );
  const shortUrl = await getSignedUrl(
    s3,
    new UploadPartCommand({
      Bucket: BUCKET,
      Key: `${KEY_PREFIX}expiry/probe.bin`,
      UploadId: expiring.UploadId,
      PartNumber: 1,
    }),
    { expiresIn: 2 },
  );
  await sleep(3500);
  const expired = await putPart(shortUrl, MIB);
  const freshUrl = await getSignedUrl(
    s3,
    new UploadPartCommand({
      Bucket: BUCKET,
      Key: `${KEY_PREFIX}expiry/probe.bin`,
      UploadId: expiring.UploadId,
      PartNumber: 1,
    }),
    { expiresIn: 60 },
  );
  const resigned = await putPart(freshUrl, MIB);
  await s3.send(
    new AbortMultipartUploadCommand({
      Bucket: BUCKET,
      Key: `${KEY_PREFIX}expiry/probe.bin`,
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
    const response = await fetch(`${minioUrl}/${BUCKET}/${KEY_PREFIX}x?partNumber=1&uploadId=x`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type",
      },
    });
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
    const response = await fetch(url, {
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
    };
  })();

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
  const lifecycle = {
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

  return {
    nonUniform: {
      sizes: nonUniformSizes,
      apiStatus: refused.status,
      apiReason: refused.body.detail,
      minioAcceptedUneven,
    },
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
    lifecycle,
  };
}

async function main(): Promise<void> {
  await mkdir(args.workdir, { recursive: true });
  const file = args.source ?? join(args.workdir, `synthetic-${args["size-mib"]}mib.bin`);
  const synthetic = args.source === undefined;
  let api: UploadApi | null = null;
  let network: Network | null = null;
  try {
    const minioVersion = await startMinio();
    log(`MinIO ${minioVersion} on ${minioUrl}`);
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
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
      listPageSize: Number(args["list-page"]),
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
    const checks = await protocolChecks(api);

    const resentBytes = upload.phases.map((phase, index) => {
      const nextListed = upload.phases[index + 1]?.bytesListedAtStart ?? fileBytes;
      return phase.proxyBytes - (nextListed - phase.bytesListedAtStart);
    });
    const report = {
      file: synthetic ? `synthetic random file of ${fileBytes} bytes` : basename(file),
      fileBytes,
      partBytes,
      partCount: plan.partCount,
      lastPartBytes: plan.lastPartBytes,
      network: { rttMs, uplinkBytesPerSecond, cutAt, reloadAt, outageMs },
      minioImage: MINIO_IMAGE,
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
        listPages: api.events
          .filter((event) => event.kind === "list")
          .map((event) => (event.kind === "list" ? event.pages : 0)),
      },
      verification,
      checks,
    };
    const json = JSON.stringify(report, null, 2);
    if (args.out) {
      await writeFile(args.out, `${json}\n`);
    }
    console.log(json);
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
    ].filter(Boolean);
    if (failures.length > 0) {
      throw new Error(failures.join("; "));
    }
    log("all checks passed");
  } finally {
    await network?.down();
    await api?.close();
    await stopMinio();
    if (synthetic && !args["keep-file"]) {
      await rm(file, { force: true });
    }
  }
}

await main();
