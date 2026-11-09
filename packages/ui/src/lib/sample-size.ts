export const defaultSampleSize = 200;
export const sampleSizeLimit = 10_000;

export const validSampleSize = (size: number) =>
  Number.isInteger(size) && size >= 1 && size <= sampleSizeLimit;
