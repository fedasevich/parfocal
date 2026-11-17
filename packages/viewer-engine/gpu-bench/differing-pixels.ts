import { PNG } from "pngjs";

const channelTolerance = 4;

export function differingPixels(first: Buffer, second: Buffer): number {
  const a = PNG.sync.read(first);
  const b = PNG.sync.read(second);
  if (a.width !== b.width || a.height !== b.height) return a.width * a.height;
  let differing = 0;
  for (let at = 0; at < a.data.length; at += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs((a.data[at + channel] ?? 0) - (b.data[at + channel] ?? 0));
      if (delta > channelTolerance) {
        differing += 1;
        break;
      }
    }
  }
  return differing;
}
