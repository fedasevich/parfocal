export const MIB = 1024 * 1024;
export const MIN_PART_BYTES = 5 * MIB;
export const MAX_PART_BYTES = 5 * 1024 * MIB;
export const MAX_PARTS = 10_000;
export const DEFAULT_PART_BYTES = 16 * MIB;

export interface PartPlan {
  readonly partBytes: number;
  readonly partCount: number;
  readonly lastPartBytes: number;
}

export interface UploadedPart {
  readonly partNumber: number;
  readonly size: number;
}

export function partSizeFor(fileBytes: number, preferredBytes = DEFAULT_PART_BYTES): number {
  if (!Number.isSafeInteger(fileBytes) || fileBytes <= 0) {
    throw new RangeError(`file size must be a positive integer, got ${fileBytes}`);
  }
  if (preferredBytes < MIN_PART_BYTES || preferredBytes % MIB !== 0) {
    throw new RangeError(`preferred part size must be a whole MiB of at least 5 MiB`);
  }
  const fewestBytes = Math.ceil(fileBytes / MAX_PARTS / MIB) * MIB;
  const partBytes = Math.max(preferredBytes, fewestBytes);
  if (partBytes > MAX_PART_BYTES) {
    throw new RangeError(`a ${fileBytes} byte file does not fit in ${MAX_PARTS} parts`);
  }
  return partBytes;
}

export function planParts(fileBytes: number, partBytes: number): PartPlan {
  const partCount = Math.ceil(fileBytes / partBytes);
  if (partCount > MAX_PARTS) {
    throw new RangeError(`${partCount} parts is more than ${MAX_PARTS}`);
  }
  return { partBytes, partCount, lastPartBytes: fileBytes - (partCount - 1) * partBytes };
}

export function partsProblem(
  parts: readonly UploadedPart[],
  fileBytes: number,
  partBytes: number,
): string | null {
  const plan = planParts(fileBytes, partBytes);
  if (parts.length !== plan.partCount) {
    return `expected ${plan.partCount} parts, found ${parts.length}`;
  }
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  for (const [index, part] of sorted.entries()) {
    const expectedBytes = index === plan.partCount - 1 ? plan.lastPartBytes : plan.partBytes;
    if (part.partNumber !== index + 1) {
      return `part ${index + 1} is missing`;
    }
    if (part.size !== expectedBytes) {
      return `part ${part.partNumber} has ${part.size} bytes, expected ${expectedBytes}`;
    }
  }
  return null;
}
