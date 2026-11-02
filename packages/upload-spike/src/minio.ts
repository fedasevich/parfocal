import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

export const MINIO_IMAGE =
  "pgsty/minio@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372";
export const MINIO_CREDENTIALS = {
  accessKeyId: "spike-access",
  secretAccessKey: "spike-secret-key-0000",
};

export async function docker(...command: string[]): Promise<string> {
  const { stdout } = await run("docker", command);
  return stdout.trim();
}

export async function dockerIsUp(): Promise<boolean> {
  try {
    await docker("version", "--format", "{{.Server.Version}}");
    await docker("image", "inspect", MINIO_IMAGE);
    return true;
  } catch {
    return false;
  }
}

export interface MinioOptions {
  readonly container: string;
  readonly port: number;
  readonly corsOrigin: string;
}

export async function startMinio(options: MinioOptions): Promise<string> {
  const url = `http://127.0.0.1:${options.port}`;
  await docker("rm", "-f", "-v", options.container).catch(() => "");
  await docker(
    "run",
    "-d",
    "--rm",
    "--name",
    options.container,
    "-p",
    `127.0.0.1:${options.port}:9000`,
    "-e",
    `MINIO_ROOT_USER=${MINIO_CREDENTIALS.accessKeyId}`,
    "-e",
    `MINIO_ROOT_PASSWORD=${MINIO_CREDENTIALS.secretAccessKey}`,
    "-e",
    `MINIO_API_CORS_ALLOW_ORIGIN=${options.corsOrigin}`,
    MINIO_IMAGE,
    "server",
    "/data",
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${url}/minio/health/live`);
      if (response.ok) {
        return (await docker("exec", options.container, "minio", "--version")).split("\n")[0] ?? "";
      }
    } catch {}
    await sleep(200);
  }
  throw new Error("MinIO did not become healthy");
}

export async function stopMinio(container: string): Promise<void> {
  await docker("rm", "-f", "-v", container).catch(() => "");
}
