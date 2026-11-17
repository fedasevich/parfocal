import { open } from "node:fs/promises";

const openingTags = new Set([258, 324, 325, 338, 339, 347]);
const imageDescriptionTag = 270;
const valueBytes: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
  16: 8,
  17: 8,
  18: 8,
};

export interface WalkedDirectory {
  readonly page: number;
  readonly ifdOffset: number;
  readonly ifdBytes: number;
  readonly valueRanges: (readonly [number, number, number])[];
  readonly description: readonly [number, number] | null;
}

export interface WalkedTiff {
  readonly littleEndian: boolean;
  readonly bigTiff: boolean;
  readonly directories: readonly WalkedDirectory[];
}

export async function walkTiffDirectories(path: string): Promise<WalkedTiff> {
  const handle = await open(path, "r");
  const read = async (offset: number, length: number): Promise<DataView> => {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    return new DataView(buffer.buffer, buffer.byteOffset, length);
  };
  try {
    const header = await read(0, 16);
    const littleEndian = header.getUint16(0, false) === 0x4949;
    const bigTiff = header.getUint16(2, littleEndian) === 43;
    const word = (view: DataView, at: number) =>
      bigTiff ? Number(view.getBigUint64(at, littleEndian)) : view.getUint32(at, littleEndian);
    const countBytes = bigTiff ? 8 : 2;
    const entryBytes = bigTiff ? 20 : 12;
    const inline = bigTiff ? 8 : 4;
    const directories: WalkedDirectory[] = [];
    let next = bigTiff ? word(header, 8) : header.getUint32(4, littleEndian);
    while (next !== 0) {
      const head = await read(next, countBytes);
      const count = bigTiff
        ? Number(head.getBigUint64(0, littleEndian))
        : head.getUint16(0, littleEndian);
      const ifdBytes = countBytes + count * entryBytes + inline;
      const table = await read(next, ifdBytes);
      const valueRanges: (readonly [number, number, number])[] = [];
      let description: readonly [number, number] | null = null;
      for (let index = 0; index < count; index++) {
        const at = countBytes + index * entryBytes;
        const tag = table.getUint16(at, littleEndian);
        const kind = table.getUint16(at + 2, littleEndian);
        const values = word(table, at + 4);
        const length = (valueBytes[kind] ?? 0) * values;
        if (length <= inline) continue;
        const offset = word(table, at + 4 + inline);
        if (openingTags.has(tag)) valueRanges.push([tag, offset, length]);
        if (tag === imageDescriptionTag) description = [offset, length];
      }
      directories.push({
        page: directories.length,
        ifdOffset: next,
        ifdBytes,
        valueRanges,
        description,
      });
      next = word(table, countBytes + count * entryBytes);
    }
    return { littleEndian, bigTiff, directories };
  } finally {
    await handle.close();
  }
}
