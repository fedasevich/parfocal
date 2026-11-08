export interface GrayImage {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

export interface Registration {
  readonly rotation: number;
  readonly shiftX: number;
  readonly shiftY: number;
  readonly score: number;
}

const gridWidth = 56;
const coarseAngleStep = 6;
const coarseShiftStep = 2;
const coarseShiftReach = 12;
const minimumOverlap = 0.5;
const minimumTissue = 0.02;
const minimumScore = 0.3;

interface Grid {
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array;
}

function sampleBilinear(image: GrayImage, x: number, y: number): number {
  const fx = Math.min(Math.max(x, 0), image.width - 1);
  const fy = Math.min(Math.max(y, 0), image.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, image.width - 1);
  const y1 = Math.min(y0 + 1, image.height - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (px: number, py: number) => image.data[py * image.width + px] ?? 0;
  return (
    at(x0, y0) * (1 - tx) * (1 - ty) +
    at(x1, y0) * tx * (1 - ty) +
    at(x0, y1) * (1 - tx) * ty +
    at(x1, y1) * tx * ty
  );
}

function boxBlur(grid: Grid): Grid {
  const { width, height, values } = grid;
  const out = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= width || py >= height) continue;
          sum += values[py * width + px] ?? 0;
          count++;
        }
      }
      out[y * width + x] = sum / count;
    }
  }
  return { width, height, values: out };
}

function tissueGrid(image: GrayImage, width: number, height: number): Grid {
  const values = new Float32Array(width * height);
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < image.width * image.height; i++) {
    const value = image.data[i] ?? 0;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  const range = Math.max(high - low, 1e-6);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = ((x + 0.5) / width) * image.width - 0.5;
      const sy = ((y + 0.5) / height) * image.height - 0.5;
      values[y * width + x] = 1 - (sampleBilinear(image, sx, sy) - low) / range;
    }
  }
  return boxBlur(boxBlur({ width, height, values }));
}

function tissueShare(grid: Grid): number {
  let sum = 0;
  for (const value of grid.values) sum += value;
  return sum / grid.values.length;
}

interface Candidate {
  readonly angle: number;
  readonly dx: number;
  readonly dy: number;
}

function correlation(a: Grid, b: Grid, candidate: Candidate): number {
  const { width, height } = a;
  const radians = (candidate.angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const mx = (width - 1) / 2;
  const my = (height - 1) / 2;
  const target: GrayImage = { width, height, data: b.values };
  let count = 0;
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rx = x - mx;
      const ry = y - my;
      const qx = rx * cos - ry * sin + mx + candidate.dx;
      const qy = rx * sin + ry * cos + my + candidate.dy;
      if (qx < 0 || qy < 0 || qx > width - 1 || qy > height - 1) continue;
      const valueA = a.values[y * width + x] ?? 0;
      const valueB = sampleBilinear(target, qx, qy);
      count++;
      sumA += valueA;
      sumB += valueB;
      sumAA += valueA * valueA;
      sumBB += valueB * valueB;
      sumAB += valueA * valueB;
    }
  }
  if (count < width * height * minimumOverlap) return -1;
  const varA = sumAA - (sumA * sumA) / count;
  const varB = sumBB - (sumB * sumB) / count;
  if (varA <= 1e-9 || varB <= 1e-9) return -1;
  return (sumAB - (sumA * sumB) / count) / Math.sqrt(varA * varB);
}

function bestOf(
  a: Grid,
  b: Grid,
  angles: readonly number[],
  shiftsX: readonly number[],
  shiftsY: readonly number[],
): { candidate: Candidate; score: number } {
  let best = { candidate: { angle: 0, dx: 0, dy: 0 }, score: -2 };
  for (const angle of angles) {
    for (const dy of shiftsY) {
      for (const dx of shiftsX) {
        const candidate = { angle, dx, dy };
        const score = correlation(a, b, candidate);
        if (score > best.score) best = { candidate, score };
      }
    }
  }
  return best;
}

const span = (centre: number, reach: number, step: number): number[] => {
  const out: number[] = [];
  for (let value = centre - reach; value <= centre + reach + 1e-9; value += step) out.push(value);
  return out;
};

export function registerThumbnails(from: GrayImage, to: GrayImage): Registration | null {
  const width = gridWidth;
  const height = Math.max(8, Math.round((gridWidth * from.height) / from.width));
  const a = tissueGrid(from, width, height);
  const b = tissueGrid(to, width, height);
  if (tissueShare(a) < minimumTissue || tissueShare(b) < minimumTissue) return null;

  const coarse = bestOf(
    a,
    b,
    span(-180, 180 - coarseAngleStep, coarseAngleStep),
    span(0, coarseShiftReach, coarseShiftStep),
    span(0, coarseShiftReach, coarseShiftStep),
  );
  const fine = bestOf(
    a,
    b,
    span(coarse.candidate.angle, coarseAngleStep, 1),
    span(coarse.candidate.dx, coarseShiftStep, 0.5),
    span(coarse.candidate.dy, coarseShiftStep, 0.5),
  );
  if (fine.score < minimumScore) return null;
  let rotation = fine.candidate.angle;
  if (rotation > 180) rotation -= 360;
  if (rotation <= -180) rotation += 360;
  return {
    rotation,
    shiftX: fine.candidate.dx / width,
    shiftY: fine.candidate.dy / height,
    score: fine.score,
  };
}
