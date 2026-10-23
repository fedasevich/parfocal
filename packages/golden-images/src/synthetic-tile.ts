import { createFrame, type Frame } from "#frame.ts";

const EOSIN: readonly [number, number, number] = [234, 160, 196];
const HAEMATOXYLIN: readonly [number, number, number] = [86, 52, 150];
const STRIP_HEIGHT = 12;

function nextSeed(seed: number): number {
  return (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
}

function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function syntheticHeTile(size = 256): Frame {
  const frame = createFrame(size, size);
  const nuclei: { x: number; y: number; radius: number }[] = [];
  let seed = 20_261_023;
  for (let index = 0; index < 40; index++) {
    seed = nextSeed(seed);
    const x = (seed % 1000) / 1000;
    seed = nextSeed(seed);
    const y = (seed % 1000) / 1000;
    seed = nextSeed(seed);
    nuclei.push({
      x: x * size,
      y: STRIP_HEIGHT * 3 + y * (size - STRIP_HEIGHT * 3),
      radius: 4 + (seed % 7),
    });
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      const ramp = Math.round((x / (size - 1)) * 255);
      if (y < STRIP_HEIGHT * 3) {
        const channel = Math.floor(y / STRIP_HEIGHT);
        const pixel = [0, 0, 0];
        pixel[channel] = ramp;
        frame.data.set([pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0, 255], offset);
        continue;
      }
      if (x >= size - 24 && y >= size - 24) {
        const on = (x + y) % 2 === 0;
        frame.data.set(on ? [255, 255, 255, 255] : [20, 20, 20, 255], offset);
        continue;
      }
      const shade = 0.5 + 0.5 * Math.sin(x / 17) * Math.cos(y / 23);
      let pixel: [number, number, number] = [
        mix(EOSIN[0], 250, shade * 0.6),
        mix(EOSIN[1], 210, shade * 0.6),
        mix(EOSIN[2], 225, shade * 0.6),
      ];
      for (const nucleus of nuclei) {
        const distance = Math.hypot(x - nucleus.x, y - nucleus.y);
        if (distance < nucleus.radius) {
          const edge = Math.min(1, (nucleus.radius - distance) / 2);
          pixel = [
            mix(pixel[0], HAEMATOXYLIN[0], edge),
            mix(pixel[1], HAEMATOXYLIN[1], edge),
            mix(pixel[2], HAEMATOXYLIN[2], edge),
          ];
        }
      }
      frame.data.set([pixel[0], pixel[1], pixel[2], 255], offset);
    }
  }
  return frame;
}
