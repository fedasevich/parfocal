import assert from "node:assert/strict";
import { test } from "node:test";
import { crcOf, zipStored } from "../src/upload/zip.ts";

const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test("the CRC matches the known value for 123456789", () => {
  assert.equal(crcOf(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("a stored zip lists every file with its name, size and CRC and ends with the zip64 records", async () => {
  const slide = new File(["mirax-slide"], "scan.mrxs", { lastModified: Date.UTC(2026, 5, 1) });
  const ini = new File(["[GENERAL]"], "Slidedat.ini", { lastModified: Date.UTC(2026, 5, 1) });
  const zip = await zipStored(
    [
      { name: "scan.mrxs", file: slide },
      { name: "scan/Slidedat.ini", file: ini },
    ],
    "scan.zip",
  );
  assert.equal(zip.name, "scan.zip");
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 0xffff);
  const locator = end - 20;
  assert.equal(view.getUint32(locator, true), 0x07064b50);
  const record = Number(view.getBigUint64(locator + 8, true));
  assert.equal(view.getUint32(record, true), 0x06064b50);
  assert.equal(Number(view.getBigUint64(record + 32, true)), 2);
  let at = Number(view.getBigUint64(record + 48, true));
  const found: { name: string; size: number; crc: number; body: string }[] = [];
  for (let index = 0; index < 2; index += 1) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const extra = at + 46 + nameLength;
    const size = Number(view.getBigUint64(extra + 4, true));
    const local = Number(view.getBigUint64(extra + 20, true));
    const localName = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    const start = local + 30 + localName + localExtra;
    found.push({
      name: textOf(bytes.subarray(at + 46, at + 46 + nameLength)),
      size,
      crc: view.getUint32(at + 16, true),
      body: textOf(bytes.subarray(start, start + size)),
    });
    at += 46 + nameLength + extraLength;
  }
  assert.deepEqual(found, [
    {
      name: "scan.mrxs",
      size: 11,
      crc: crcOf(new TextEncoder().encode("mirax-slide")),
      body: "mirax-slide",
    },
    {
      name: "scan/Slidedat.ini",
      size: 9,
      crc: crcOf(new TextEncoder().encode("[GENERAL]")),
      body: "[GENERAL]",
    },
  ]);
});
