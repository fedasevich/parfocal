export interface FrameInfo {
  readonly width: number;
  readonly height: number;
  readonly bitsPerSample: number;
  readonly componentCount: number;
  readonly isSigned: boolean;
}

export interface J2KDecoder {
  getEncodedBuffer(length: number): Uint8Array;
  getDecodedBuffer(): Uint8Array;
  decode(): void;
  getFrameInfo(): FrameInfo;
  delete(): void;
}

export interface OpenJpegModule {
  readonly J2KDecoder: new () => J2KDecoder;
}

export interface OpenJpegOptions {
  print(message: string): void;
  printErr(message: string): void;
  locateFile?(path: string): string;
}

declare const openJpegFactory: (options: OpenJpegOptions) => Promise<OpenJpegModule>;

export default openJpegFactory;
