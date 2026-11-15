export const bufferUsage = {
  mapRead: 0x0001,
  copySrc: 0x0004,
  copyDst: 0x0008,
  vertex: 0x0020,
  uniform: 0x0040,
  queryResolve: 0x0200,
} as const;

export const textureUsage = {
  copyDst: 0x02,
  textureBinding: 0x04,
  renderAttachment: 0x10,
} as const;

export const mapModeRead = 0x1;

export const shaderStage = {
  vertex: 0x1,
  fragment: 0x2,
} as const;
