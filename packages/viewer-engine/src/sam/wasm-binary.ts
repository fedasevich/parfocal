const gzipMagic = [0x1f, 0x8b] as const;

function isGzip(bytes: Uint8Array): boolean {
  return bytes[0] === gzipMagic[0] && bytes[1] === gzipMagic[1];
}

async function gunzip(bytes: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function loadWasmBinary(
  url: string,
  fetchBytes: (url: string) => Promise<Response> = fetch,
): Promise<ArrayBuffer> {
  const response = await fetchBytes(url);
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return isGzip(bytes) ? gunzip(bytes) : bytes.buffer;
}
