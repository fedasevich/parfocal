export type ZipSource = { name: string; file: File };

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

export function crcOf(chunk: Uint8Array, crc = 0): number {
  let value = ~crc >>> 0;
  for (const byte of chunk) value = (crcTable[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  return ~value >>> 0;
}

export async function crcOfFile(file: Blob): Promise<number> {
  const reader = file.stream().getReader();
  let crc = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return crc;
    crc = crcOf(value, crc);
  }
}

const textEncoder = new TextEncoder();

function dosStamp(time: number): { time: number; date: number } {
  const moment = new Date(Math.max(time, Date.UTC(1980, 0, 1)));
  return {
    time: (moment.getHours() << 11) | (moment.getMinutes() << 5) | (moment.getSeconds() >> 1),
    date: ((moment.getFullYear() - 1980) << 9) | ((moment.getMonth() + 1) << 5) | moment.getDate(),
  };
}

class Writer {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly view: DataView;
  at = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  u16(value: number) {
    this.view.setUint16(this.at, value, true);
    this.at += 2;
  }

  u32(value: number) {
    this.view.setUint32(this.at, value, true);
    this.at += 4;
  }

  u64(value: number) {
    this.view.setBigUint64(this.at, BigInt(value), true);
    this.at += 8;
  }

  text(value: Uint8Array) {
    this.bytes.set(value, this.at);
    this.at += value.length;
  }
}

const MAX32 = 0xffffffff;
const VERSION = 45;
const UTF8 = 0x0800;

type Entry = {
  name: Uint8Array;
  file: Blob;
  crc: number;
  stamp: { time: number; date: number };
  offset: number;
};

function localHeader(entry: Entry) {
  const writer = new Writer(30 + entry.name.length + 20);
  writer.u32(0x04034b50);
  writer.u16(VERSION);
  writer.u16(UTF8);
  writer.u16(0);
  writer.u16(entry.stamp.time);
  writer.u16(entry.stamp.date);
  writer.u32(entry.crc);
  writer.u32(MAX32);
  writer.u32(MAX32);
  writer.u16(entry.name.length);
  writer.u16(20);
  writer.text(entry.name);
  writer.u16(1);
  writer.u16(16);
  writer.u64(entry.file.size);
  writer.u64(entry.file.size);
  return writer.bytes;
}

function centralHeader(entry: Entry) {
  const writer = new Writer(46 + entry.name.length + 28);
  writer.u32(0x02014b50);
  writer.u16(VERSION);
  writer.u16(VERSION);
  writer.u16(UTF8);
  writer.u16(0);
  writer.u16(entry.stamp.time);
  writer.u16(entry.stamp.date);
  writer.u32(entry.crc);
  writer.u32(MAX32);
  writer.u32(MAX32);
  writer.u16(entry.name.length);
  writer.u16(28);
  writer.u16(0);
  writer.u16(0);
  writer.u16(0);
  writer.u32(0);
  writer.u32(MAX32);
  writer.text(entry.name);
  writer.u16(1);
  writer.u16(24);
  writer.u64(entry.file.size);
  writer.u64(entry.file.size);
  writer.u64(entry.offset);
  return writer.bytes;
}

function ending(count: number, directorySize: number, directoryAt: number) {
  const writer = new Writer(56 + 20 + 22);
  writer.u32(0x06064b50);
  writer.u64(44);
  writer.u16(VERSION);
  writer.u16(VERSION);
  writer.u32(0);
  writer.u32(0);
  writer.u64(count);
  writer.u64(count);
  writer.u64(directorySize);
  writer.u64(directoryAt);
  writer.u32(0x07064b50);
  writer.u32(0);
  writer.u64(directoryAt + directorySize);
  writer.u32(1);
  writer.u32(0x06054b50);
  writer.u16(0);
  writer.u16(0);
  writer.u16(0xffff);
  writer.u16(0xffff);
  writer.u32(MAX32);
  writer.u32(MAX32);
  writer.u16(0);
  return writer.bytes;
}

export async function zipStored(sources: readonly ZipSource[], name: string): Promise<File> {
  const parts: BlobPart[] = [];
  const entries: Entry[] = [];
  let offset = 0;
  for (const source of sources) {
    const entry: Entry = {
      name: textEncoder.encode(source.name),
      file: source.file,
      crc: await crcOfFile(source.file),
      stamp: dosStamp(source.file.lastModified),
      offset,
    };
    const header = localHeader(entry);
    parts.push(header, source.file);
    offset += header.length + source.file.size;
    entries.push(entry);
  }
  const directory = entries.map(centralHeader);
  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  parts.push(...directory, ending(entries.length, directorySize, offset));
  return new File(parts, name, {
    type: "application/zip",
    lastModified: Math.max(0, ...sources.map((source) => source.file.lastModified)),
  });
}
