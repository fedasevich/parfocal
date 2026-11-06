export class PfcError extends Error {
  override name = "PfcError";
}

export class UnknownPfcVersionError extends PfcError {
  readonly version: unknown;

  constructor(version: unknown) {
    super(`This file has schema version ${String(version)}, and this reader knows only 1`);
    this.name = "UnknownPfcVersionError";
    this.version = version;
  }
}

export type PfcArray = Uint8Array | Uint16Array | Uint32Array | Float32Array;

export interface PfcField {
  readonly name: string;
  readonly type: string;
  readonly offset: number;
  readonly length: number;
}

export interface PfcHeader {
  readonly version: number;
  readonly kind: string;
  readonly count: number;
  readonly classes?: number;
  readonly fields: readonly PfcField[];
  readonly [key: string]: unknown;
}

export interface PfcFile {
  readonly header: PfcHeader;
  readonly arrays: ReadonlyMap<string, PfcArray>;
  readonly byteLength: number;
}

export const SUPPORTED_VERSION = 1;
const MAGIC = [0x50, 0x46, 0x43, 0x31] as const;
const PREAMBLE_BYTES = 8;
const ALIGNMENT = 8;

const ELEMENT_BYTES: Readonly<Record<string, number>> = { u1: 1, u2: 2, u4: 4, f4: 4 };

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (!isGzip(bytes)) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function typedView(type: string, buffer: ArrayBuffer, offset: number, length: number): PfcArray {
  if (type === "u1") return new Uint8Array(buffer, offset, length);
  if (type === "u2") return new Uint16Array(buffer, offset, length);
  if (type === "u4") return new Uint32Array(buffer, offset, length);
  return new Float32Array(buffer, offset, length);
}

function aligned(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.byteOffset % ALIGNMENT === 0 && bytes.buffer instanceof ArrayBuffer) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
  }
  return new Uint8Array(bytes);
}

function parsedHeader(bytes: Uint8Array, headerBytes: number): PfcHeader {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder().decode(bytes.subarray(PREAMBLE_BYTES, PREAMBLE_BYTES + headerBytes)),
    );
  } catch {
    throw new PfcError("The file header is not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PfcError("The file header is not a JSON object");
  }
  const header = parsed as Partial<PfcHeader>;
  if (header.version !== SUPPORTED_VERSION) throw new UnknownPfcVersionError(header.version);
  if (typeof header.count !== "number" || !Array.isArray(header.fields)) {
    throw new PfcError("The file header has no count or fields");
  }
  return header as PfcHeader;
}

export function readPfc(plain: Uint8Array): PfcFile {
  const bytes = aligned(plain);
  if (bytes.length < PREAMBLE_BYTES || MAGIC.some((value, index) => bytes[index] !== value)) {
    throw new PfcError("This is not a Parfocal file");
  }
  const headerBytes = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
  const header = parsedHeader(bytes, headerBytes);
  const base = PREAMBLE_BYTES + headerBytes;
  const arrays = new Map<string, PfcArray>();
  for (const field of header.fields) {
    const size = ELEMENT_BYTES[field.type];
    if (size === undefined) continue;
    if (base + field.offset + field.length * size > bytes.length) {
      throw new PfcError(`${field.name} runs past the end of the file`);
    }
    arrays.set(
      field.name,
      typedView(field.type, bytes.buffer, bytes.byteOffset + base + field.offset, field.length),
    );
  }
  return { header, arrays, byteLength: bytes.length };
}

export async function decodePfc(bytes: Uint8Array<ArrayBuffer>): Promise<PfcFile> {
  return readPfc(await inflate(bytes));
}

export function column<T extends PfcArray>(
  file: PfcFile,
  name: string,
  type: abstract new (...args: never[]) => T,
  perCell = 1,
): T {
  const found = file.arrays.get(name);
  if (!(found instanceof type)) throw new PfcError(`${name} is missing or has the wrong type`);
  if (perCell > 0 && found.length !== file.header.count * perCell) {
    throw new PfcError(`${name} has ${found.length} values for ${file.header.count} cells`);
  }
  return found;
}

export function optionalColumn<T extends PfcArray>(
  file: PfcFile,
  name: string,
  type: abstract new (...args: never[]) => T,
  perCell = 1,
): T | null {
  return file.arrays.has(name) ? column(file, name, type, perCell) : null;
}
