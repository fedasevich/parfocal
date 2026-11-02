import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { type LatencyProxy, startLatencyProxy } from "@parfocal/latency-proxy";
import { sha256OfStream } from "./digest.ts";
import { MINIO_CREDENTIALS, startMinio, stopMinio } from "./minio.ts";
import { type ApiEvent, startUploadApi, type UploadApi } from "./upload-api.ts";

export interface StorageStackOptions {
  readonly appOrigin: string;
  readonly apiPort: number;
  readonly s3Port: number;
  readonly minioPort: number;
  readonly container: string;
  readonly uplinkBytesPerSecond: number;
  readonly rttMs: number;
  readonly partBytes: number;
}

export interface StoredObject {
  readonly bytes: number;
  readonly sha256: string;
}

export interface StorageStack {
  readonly api: UploadApi;
  readonly minioVersion: string;
  linkIsUp(): boolean;
  cutLink(): Promise<void>;
  restoreLink(): Promise<void>;
  uploadedBytes(): number;
  openStorageUploads(): Promise<number>;
  eventsOf<K extends ApiEvent["kind"]>(kind: K): Extract<ApiEvent, { kind: K }>[];
  completedObject(): Promise<StoredObject | null>;
  stop(): Promise<void>;
}

const BUCKET = "parfocal-web-e2e";
const KEY_PREFIX = "t/e2e-tenant/quarantine/";

export async function startStorageStack(options: StorageStackOptions): Promise<StorageStack> {
  const minioUrl = `http://127.0.0.1:${options.minioPort}`;
  const minioVersion = await startMinio({
    container: options.container,
    port: options.minioPort,
    corsOrigin: options.appOrigin,
  });
  const s3 = new S3Client({
    endpoint: minioUrl,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: MINIO_CREDENTIALS,
  });
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));

  let proxy: LatencyProxy | null = null;
  let uploadedBefore = 0;

  const raiseLink = async (): Promise<void> => {
    proxy = await startLatencyProxy({
      target: minioUrl,
      port: options.s3Port,
      rttMs: options.rttMs,
      uplinkBytesPerSecond: options.uplinkBytesPerSecond,
    });
  };
  await raiseLink();

  const api = await startUploadApi({
    s3,
    bucket: BUCKET,
    publicS3Url: () => `http://127.0.0.1:${options.s3Port}`,
    keyPrefix: KEY_PREFIX,
    partUrlExpirySeconds: 900,
    preferredPartBytes: options.partBytes,
    listPageSize: 100,
    port: options.apiPort,
    basePath: "/e2e/uploads",
    corsOrigin: options.appOrigin,
  });

  return {
    api,
    minioVersion,
    linkIsUp: () => proxy !== null,
    async cutLink() {
      if (proxy === null) return;
      uploadedBefore += proxy.stats().uploadedBytes;
      const closing = proxy.close();
      proxy = null;
      await closing;
    },
    restoreLink: raiseLink,
    uploadedBytes: () => uploadedBefore + (proxy?.stats().uploadedBytes ?? 0),
    async openStorageUploads() {
      const listed = await s3.send(new ListMultipartUploadsCommand({ Bucket: BUCKET }));
      return listed.Uploads?.length ?? 0;
    },
    eventsOf<K extends ApiEvent["kind"]>(kind: K) {
      return api.events.filter((event): event is Extract<ApiEvent, { kind: K }> => {
        return event.kind === kind;
      });
    },
    async completedObject() {
      const complete = api.events.find((event) => event.kind === "complete");
      const created = api.events.find((event) => event.kind === "create");
      if (complete === undefined || created === undefined) return null;
      const key = created.key;
      const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      const sha256 = await sha256OfStream(object.Body as AsyncIterable<Uint8Array>);
      return { bytes: head.ContentLength ?? 0, sha256 };
    },
    async stop() {
      await proxy?.close();
      proxy = null;
      await api.close();
      s3.destroy();
      await stopMinio(options.container);
    },
  };
}
