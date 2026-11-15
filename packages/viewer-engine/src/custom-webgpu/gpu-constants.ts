export const bufferUsage = {
  copyDst: 0x0008,
  vertex: 0x0020,
  uniform: 0x0040,
} as const;

export const textureUsage = {
  copyDst: 0x02,
  textureBinding: 0x04,
  renderAttachment: 0x10,
} as const;

export const shaderStage = {
  vertex: 0x1,
  fragment: 0x2,
} as const;
