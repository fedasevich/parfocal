import { createHash, createHmac } from "node:crypto";

export const fixtureBucket = "parfocal-dev";
export const fixturePrefix = "fixtures/";

export type Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
};

export type FixtureMirror = Credentials & {
  endpoint: string;
};

export type PresignOptions = {
  method?: string;
  region?: string;
  now?: Date;
  expiresSeconds?: number;
};

const hmac = (key: string | Buffer, data: string) =>
  createHmac("sha256", key).update(data).digest();
const sha256Hex = (data: string) => createHash("sha256").update(data).digest("hex");

const encodeRfc3986 = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const encodePath = (path: string) => path.split("/").map(encodeRfc3986).join("/");

function amzDate(now: Date) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return { stamp, day: stamp.slice(0, 8) };
}

export function presignUrl(
  url: string,
  credentials: Credentials,
  options: PresignOptions = {},
): string {
  const target = new URL(url);
  const method = options.method ?? "GET";
  const region = options.region ?? "auto";
  const { stamp, day } = amzDate(options.now ?? new Date());
  const scope = `${day}/${region}/s3/aws4_request`;

  const query: [string, string][] = [
    ...target.searchParams.entries(),
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${credentials.accessKeyId}/${scope}`],
    ["X-Amz-Date", stamp],
    ["X-Amz-Expires", String(options.expiresSeconds ?? 3600)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = query
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .sort()
    .join("&");
  const path = encodePath(decodeURIComponent(target.pathname));
  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    `host:${target.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = ["s3", "aws4_request"].reduce(
    (key, part) => hmac(key, part),
    hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region),
  );
  const signature = hmac(signingKey, stringToSign).toString("hex");
  return `${target.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function fixtureMirror(env: NodeJS.ProcessEnv = process.env): FixtureMirror | undefined {
  const endpoint = env.PARFOCAL_FIXTURES_R2_ENDPOINT;
  const accessKeyId = env.PARFOCAL_FIXTURES_R2_ACCESS_KEY_ID;
  const secretAccessKey = env.PARFOCAL_FIXTURES_R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return undefined;
  return { endpoint: endpoint.replace(/\/+$/, ""), accessKeyId, secretAccessKey };
}

export function mirrorUrl(mirror: FixtureMirror, file: string, options: PresignOptions = {}) {
  return presignUrl(`${mirror.endpoint}/${fixtureBucket}/${fixturePrefix}${file}`, mirror, options);
}
