import { readPng, writePng } from "@parfocal/golden-images";

const [out, columnsText, ...inputs] = process.argv.slice(2);
if (!out || !columnsText || inputs.length === 0) {
  console.error("Usage: node e2e/tile-shots.ts OUT.png COLUMNS IN.png...");
  process.exit(1);
}
const frames = inputs.map((path) => readPng(path));
const columns = Number(columnsText);
const rows = Math.ceil(frames.length / columns);
const cellWidth = Math.max(...frames.map((frame) => frame.width));
const cellHeight = Math.max(...frames.map((frame) => frame.height));
const gap = 8;
const width = columns * cellWidth + (columns - 1) * gap;
const height = rows * cellHeight + (rows - 1) * gap;
const data = new Uint8Array(width * height * 4).fill(255);
frames.forEach((frame, index) => {
  const left = (index % columns) * (cellWidth + gap);
  const top = Math.floor(index / columns) * (cellHeight + gap);
  for (let y = 0; y < frame.height; y += 1) {
    const from = y * frame.width * 4;
    data.set(frame.data.subarray(from, from + frame.width * 4), ((top + y) * width + left) * 4);
  }
});
writePng(out, { width, height, data });
console.log(`${out} ${width}x${height}`);
