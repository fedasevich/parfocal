import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureMirror, mirrorUrl, presignUrl } from "../src/r2.ts";

const awsExample = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

test("matches the published AWS presigned URL example", () => {
  const url = presignUrl("https://examplebucket.s3.amazonaws.com/test.txt", awsExample, {
    region: "us-east-1",
    now: new Date("2013-05-24T00:00:00Z"),
    expiresSeconds: 86400,
  });
  const signature = new URL(url).searchParams.get("X-Amz-Signature");
  assert.equal(signature, "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  assert.match(
    url,
    /X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request/,
  );
});

test("signs the fixture key under the fixtures prefix of parfocal-dev", () => {
  const mirror = { endpoint: "https://account.r2.cloudflarestorage.com", ...awsExample };
  const url = new URL(mirrorUrl(mirror, "CMU-1 (copy).svs", { now: new Date(0) }));
  assert.equal(url.host, "account.r2.cloudflarestorage.com");
  assert.equal(url.pathname, "/parfocal-dev/fixtures/CMU-1%20%28copy%29.svs");
  assert.equal(
    url.searchParams.get("X-Amz-Credential"),
    "AKIAIOSFODNN7EXAMPLE/19700101/auto/s3/aws4_request",
  );
  assert.equal(url.searchParams.get("X-Amz-Expires"), "3600");
});

test("needs the endpoint and both halves of the key", () => {
  const env = {
    PARFOCAL_FIXTURES_R2_ENDPOINT: "https://account.r2.cloudflarestorage.com/",
    PARFOCAL_FIXTURES_R2_ACCESS_KEY_ID: "id",
    PARFOCAL_FIXTURES_R2_SECRET_ACCESS_KEY: "secret",
  };
  assert.deepEqual(fixtureMirror(env), {
    endpoint: "https://account.r2.cloudflarestorage.com",
    accessKeyId: "id",
    secretAccessKey: "secret",
  });
  assert.equal(fixtureMirror({ ...env, PARFOCAL_FIXTURES_R2_SECRET_ACCESS_KEY: "" }), undefined);
  assert.equal(fixtureMirror({}), undefined);
});
