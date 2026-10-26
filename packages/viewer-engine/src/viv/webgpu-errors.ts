export type GpuErrorFilter = "validation" | "out-of-memory" | "internal";

export interface GpuErrorLike {
  readonly message: string;
}

export interface UncapturedErrorEventLike {
  readonly error: GpuErrorLike;
  preventDefault(): void;
}

export interface DeviceLostInfoLike {
  readonly reason: string;
  readonly message: string;
}

export interface WebGpuDeviceLike {
  readonly lost: Promise<DeviceLostInfoLike>;
  addEventListener(
    type: "uncapturederror",
    listener: (event: UncapturedErrorEventLike) => void,
  ): void;
  removeEventListener(
    type: "uncapturederror",
    listener: (event: UncapturedErrorEventLike) => void,
  ): void;
  pushErrorScope(filter: GpuErrorFilter): void;
  popErrorScope(): Promise<GpuErrorLike | null>;
}

export class WebGpuError extends Error {
  readonly source: "uncaptured" | "scope" | "device-lost";
  readonly filter: GpuErrorFilter | null;

  constructor(
    source: WebGpuError["source"],
    message: string,
    filter: GpuErrorFilter | null = null,
  ) {
    super(message);
    this.name = "WebGpuError";
    this.source = source;
    this.filter = filter;
  }
}

export interface WebGpuWatchOptions {
  readonly onError: (error: WebGpuError) => void;
}

export interface WebGpuWatch {
  readonly uncaptured: () => number;
  readonly stop: () => void;
}

const intentionalLossReason = "destroyed";

export function watchWebGpuDevice(
  device: WebGpuDeviceLike,
  options: WebGpuWatchOptions,
): WebGpuWatch {
  let uncaptured = 0;
  let stopped = false;

  const onUncaptured = (event: UncapturedErrorEventLike) => {
    if (stopped) return;
    event.preventDefault();
    uncaptured += 1;
    options.onError(new WebGpuError("uncaptured", event.error.message));
  };

  device.addEventListener("uncapturederror", onUncaptured);
  device.lost.then(
    (info) => {
      if (stopped || info.reason === intentionalLossReason) return;
      options.onError(new WebGpuError("device-lost", info.message));
    },
    () => {},
  );

  return {
    uncaptured: () => uncaptured,
    stop: () => {
      if (stopped) return;
      stopped = true;
      device.removeEventListener("uncapturederror", onUncaptured);
    },
  };
}

export const allErrorFilters: readonly GpuErrorFilter[] = [
  "validation",
  "out-of-memory",
  "internal",
];

export interface ScopedResult<Result> {
  readonly result: Result;
  readonly errors: readonly WebGpuError[];
}

async function popScopes(
  device: Pick<WebGpuDeviceLike, "popErrorScope">,
  filters: readonly GpuErrorFilter[],
): Promise<WebGpuError[]> {
  const errors: WebGpuError[] = [];
  for (let index = filters.length - 1; index >= 0; index--) {
    const error = await device.popErrorScope();
    if (error !== null)
      errors.push(new WebGpuError("scope", error.message, filters[index] ?? null));
  }
  return errors;
}

export async function withErrorScopes<Result>(
  device: Pick<WebGpuDeviceLike, "pushErrorScope" | "popErrorScope">,
  run: () => Result | Promise<Result>,
  filters: readonly GpuErrorFilter[] = allErrorFilters,
): Promise<ScopedResult<Result>> {
  for (const filter of filters) device.pushErrorScope(filter);
  let result: Result;
  try {
    result = await run();
  } catch (error) {
    await popScopes(device, filters);
    throw error;
  }
  return { result, errors: await popScopes(device, filters) };
}
