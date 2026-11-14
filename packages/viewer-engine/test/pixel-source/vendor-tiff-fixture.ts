export interface PlainPage {
  readonly width: number;
  readonly height: number;
  readonly tile: number;
  readonly pixelsPerCentimetre: number;
  readonly sample: (x: number, y: number) => readonly [number, number, number];
  readonly metadata?: string;
}

const tag = {
  imageWidth: 256,
  imageLength: 257,
  bitsPerSample: 258,
  compression: 259,
  photometric: 262,
  samplesPerPixel: 277,
  xResolution: 282,
  yResolution: 283,
  planarConfiguration: 284,
  resolutionUnit: 296,
  tileWidth: 322,
  tileLength: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  argosMetadata: 65000,
} as const;

const type = { ascii: 2, short: 3, long: 4, rational: 5 } as const;
const typeSize: Record<number, number> = { 2: 1, 3: 2, 4: 4, 5: 8 };
const headerSize = 8;
const entrySize = 12;
const uncompressed = 1;
const rgb = 2;
const chunky = 1;
const centimetre = 3;

interface Entry {
  readonly tag: number;
  readonly type: number;
  readonly values: readonly number[];
}

function count(entry: Entry): number {
  return entry.type === type.rational ? entry.values.length / 2 : entry.values.length;
}

function byteLength(entry: Entry): number {
  return count(entry) * (typeSize[entry.type] ?? 0);
}

function spillLength(entry: Entry): number {
  return byteLength(entry) + (byteLength(entry) % 2);
}

function writeValues(view: DataView, at: number, entry: Entry): void {
  const size = entry.type === type.ascii ? 1 : entry.type === type.short ? 2 : 4;
  entry.values.forEach((value, index) => {
    if (size === 1) view.setUint8(at + index, value);
    else if (size === 2) view.setUint16(at + index * size, value, true);
    else view.setUint32(at + index * size, value, true);
  });
}

function tilePixels(page: PlainPage, column: number, row: number): Uint8Array {
  const pixels = new Uint8Array(page.tile * page.tile * 3);
  for (let y = 0; y < page.tile; y++) {
    const sourceY = row * page.tile + y;
    if (sourceY >= page.height) break;
    for (let x = 0; x < page.tile; x++) {
      const sourceX = column * page.tile + x;
      if (sourceX >= page.width) break;
      pixels.set(page.sample(sourceX, sourceY), (y * page.tile + x) * 3);
    }
  }
  return pixels;
}

function entriesOf(page: PlainPage, offsets: readonly number[]): Entry[] {
  const tileBytes = page.tile * page.tile * 3;
  const metadata: Entry[] =
    page.metadata === undefined
      ? []
      : [
          {
            tag: tag.argosMetadata,
            type: type.ascii,
            values: [...new TextEncoder().encode(page.metadata), 0],
          },
        ];
  return [
    { tag: tag.imageWidth, type: type.long, values: [page.width] },
    { tag: tag.imageLength, type: type.long, values: [page.height] },
    { tag: tag.bitsPerSample, type: type.short, values: [8, 8, 8] },
    { tag: tag.compression, type: type.short, values: [uncompressed] },
    { tag: tag.photometric, type: type.short, values: [rgb] },
    { tag: tag.samplesPerPixel, type: type.short, values: [3] },
    { tag: tag.xResolution, type: type.rational, values: [page.pixelsPerCentimetre, 1] },
    { tag: tag.yResolution, type: type.rational, values: [page.pixelsPerCentimetre, 1] },
    { tag: tag.planarConfiguration, type: type.short, values: [chunky] },
    { tag: tag.resolutionUnit, type: type.short, values: [centimetre] },
    { tag: tag.tileWidth, type: type.long, values: [page.tile] },
    { tag: tag.tileLength, type: type.long, values: [page.tile] },
    { tag: tag.tileOffsets, type: type.long, values: offsets },
    { tag: tag.tileByteCounts, type: type.long, values: offsets.map(() => tileBytes) },
    ...metadata,
  ];
}

function directorySize(entries: readonly Entry[]): number {
  const spilled = entries.map(spillLength).filter((size) => size > 4);
  return 2 + entries.length * entrySize + 4 + spilled.reduce((sum, size) => sum + size, 0);
}

export function plainTiledTiff(pages: readonly PlainPage[]): Uint8Array {
  const tileGrids = pages.map((page) => ({
    columns: Math.ceil(page.width / page.tile),
    rows: Math.ceil(page.height / page.tile),
    tileBytes: page.tile * page.tile * 3,
  }));
  const directorySizes = pages.map((page, index) => {
    const grid = tileGrids[index];
    const tiles = grid === undefined ? 0 : grid.columns * grid.rows;
    return directorySize(entriesOf(page, new Array<number>(tiles).fill(0)));
  });
  const directoriesEnd = headerSize + directorySizes.reduce((sum, size) => sum + size, 0);
  const dataSize = tileGrids.reduce(
    (sum, grid) => sum + grid.columns * grid.rows * grid.tileBytes,
    0,
  );
  const bytes = new Uint8Array(directoriesEnd + dataSize);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42, true);
  view.setUint32(4, headerSize, true);
  let directoryAt = headerSize;
  let dataAt = directoriesEnd;
  pages.forEach((page, index) => {
    const grid = tileGrids[index];
    if (grid === undefined) return;
    const offsets: number[] = [];
    for (let row = 0; row < grid.rows; row++) {
      for (let column = 0; column < grid.columns; column++) {
        offsets.push(dataAt);
        bytes.set(tilePixels(page, column, row), dataAt);
        dataAt += grid.tileBytes;
      }
    }
    const entries = entriesOf(page, offsets);
    const size = directorySizes[index] ?? 0;
    view.setUint16(directoryAt, entries.length, true);
    let spill = directoryAt + 2 + entries.length * entrySize + 4;
    entries.forEach((entry, position) => {
      const base = directoryAt + 2 + position * entrySize;
      view.setUint16(base, entry.tag, true);
      view.setUint16(base + 2, entry.type, true);
      view.setUint32(base + 4, count(entry), true);
      if (byteLength(entry) <= 4) {
        writeValues(view, base + 8, entry);
      } else {
        view.setUint32(base + 8, spill, true);
        writeValues(view, spill, entry);
        spill += spillLength(entry);
      }
    });
    const next = index === pages.length - 1 ? 0 : directoryAt + size;
    view.setUint32(directoryAt + 2 + entries.length * entrySize, next, true);
    directoryAt += size;
  });
  return bytes;
}

export function philipsDescription(
  images: readonly { readonly type: string; readonly spacing: string }[],
  attributeOrder: "name-first" | "name-last" = "name-first",
): string {
  const attribute = (name: string, kind: string, value: string) =>
    attributeOrder === "name-first"
      ? `<Attribute Name="${name}" Group="0x0028" Element="0x0030" PMSVR="${kind}">${value}</Attribute>`
      : `<Attribute Element="0x0030" Group="0x0028" Name="${name}" PMSVR="${kind}">${value}</Attribute>`;
  const scanned = images
    .map(
      (image) =>
        `<DataObject ObjectType="DPScannedImage">${attribute("DICOM_PIXEL_SPACING", "IDoubleArray", image.spacing)}${attribute("PIM_DP_IMAGE_TYPE", "IString", image.type)}<Attribute Name="PIIM_PIXEL_DATA_REPRESENTATION_SEQUENCE" PMSVR="IDataObjectArray"><Array><DataObject ObjectType="PixelDataRepresentation">${attribute("DICOM_PIXEL_SPACING", "IDoubleArray", "&quot;0.002&quot; &quot;0.002&quot;")}</DataObject></Array></Attribute></DataObject>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" ?><DataObject ObjectType="DPUfsImport"><Attribute Name="PIM_DP_SCANNED_IMAGES" PMSVR="IDataObjectArray"><Array>${scanned}</Array></Attribute></DataObject>`;
}
