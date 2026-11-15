export interface MipLevel {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array<ArrayBuffer>;
}

const channels = 4;

function halve(level: MipLevel): MipLevel {
  const width = Math.max(1, level.width >> 1);
  const height = Math.max(1, level.height >> 1);
  const stepX = level.width > 1 ? 2 : 1;
  const stepY = level.height > 1 ? 2 : 1;
  const rgba = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let channel = 0; channel < channels; channel++) {
        let sum = 0;
        for (let dy = 0; dy < stepY; dy++) {
          for (let dx = 0; dx < stepX; dx++) {
            const from = ((y * stepY + dy) * level.width + x * stepX + dx) * channels + channel;
            sum += level.rgba[from] ?? 0;
          }
        }
        rgba[(y * width + x) * channels + channel] = Math.round(sum / (stepX * stepY));
      }
    }
  }
  return { width, height, rgba };
}

export function mipChain(base: MipLevel): MipLevel[] {
  const levels = [base];
  let last = base;
  while (last.width > 1 || last.height > 1) {
    last = halve(last);
    levels.push(last);
  }
  return levels;
}
