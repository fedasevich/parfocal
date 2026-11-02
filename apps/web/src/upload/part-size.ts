export const MIB = 1024 * 1024;
export const MIN_PART_BYTES = 5 * MIB;
export const MAX_PART_BYTES = 5 * 1024 * MIB;
export const MAX_PARTS = 10_000;
export const DEFAULT_PART_BYTES = 16 * MIB;

export function partSizeFor(fileBytes: number, preferredBytes = DEFAULT_PART_BYTES): number {
  if (!Number.isSafeInteger(fileBytes) || fileBytes <= 0) {
    throw new RangeError(`file size must be a positive integer, got ${fileBytes}`);
  }
  if (preferredBytes < MIN_PART_BYTES || preferredBytes % MIB !== 0) {
    throw new RangeError("preferred part size must be a whole MiB of at least 5 MiB");
  }
  const fewestBytes = Math.ceil(fileBytes / MAX_PARTS / MIB) * MIB;
  const partBytes = Math.max(preferredBytes, fewestBytes);
  if (partBytes > MAX_PART_BYTES) {
    throw new RangeError(`a ${fileBytes} byte file does not fit in ${MAX_PARTS} parts`);
  }
  return partBytes;
}
