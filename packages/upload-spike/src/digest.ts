import { createHash, randomFillSync } from "node:crypto";
import { open } from "node:fs/promises";

export interface FileDigest {
  readonly bytes: number;
  readonly sha256: string;
  readonly partMd5: readonly string[];
  readonly multipartEtag: string;
}

const CHUNK_BYTES = 8 * 1024 * 1024;

export async function writeRandomFile(path: string, bytes: number): Promise<void> {
  const handle = await open(path, "w");
  try {
    const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
    for (let written = 0; written < bytes; ) {
      const length = Math.min(CHUNK_BYTES, bytes - written);
      randomFillSync(chunk, 0, length);
      await handle.write(chunk, 0, length);
      written += length;
    }
  } finally {
    await handle.close();
  }
}

export function multipartEtag(partMd5: readonly string[]): string {
  const joined = Buffer.concat(partMd5.map((md5) => Buffer.from(md5, "hex")));
  return `${createHash("md5").update(joined).digest("hex")}-${partMd5.length}`;
}

export async function digestFile(path: string, partBytes: number): Promise<FileDigest> {
  const handle = await open(path, "r");
  try {
    const whole = createHash("sha256");
    const partMd5: string[] = [];
    let part = createHash("md5");
    let inPart = 0;
    let total = 0;
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    for (;;) {
      const room = Math.min(CHUNK_BYTES, partBytes - inPart);
      const { bytesRead } = await handle.read(buffer, 0, room, null);
      if (bytesRead === 0) {
        break;
      }
      const slice = buffer.subarray(0, bytesRead);
      whole.update(slice);
      part.update(slice);
      inPart += bytesRead;
      total += bytesRead;
      if (inPart === partBytes) {
        partMd5.push(part.digest("hex"));
        part = createHash("md5");
        inPart = 0;
      }
    }
    if (inPart > 0) {
      partMd5.push(part.digest("hex"));
    }
    return {
      bytes: total,
      sha256: whole.digest("hex"),
      partMd5,
      multipartEtag: multipartEtag(partMd5),
    };
  } finally {
    await handle.close();
  }
}

export async function sha256OfStream(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}
