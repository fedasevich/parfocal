import type { CameraInput } from "./camera-input.ts";
import type { RawInput } from "./intents.ts";

export const spaceMouseVendorIds = [0x256f, 0x046d] as const;
export const spaceMouseUsagePage = 0x01;
export const spaceMouseUsage = 0x08;
export const spaceMouseFullRange = 350;

export const spaceMouseFilters = spaceMouseVendorIds.map((vendorId) => ({
  vendorId,
  usagePage: spaceMouseUsagePage,
  usage: spaceMouseUsage,
}));

export const spaceMouseButtonNames: readonly string[] = [
  "left",
  "right",
  "side-next",
  "side-previous",
];

export type SpaceMouseReport = {
  readonly reportId: number;
  readonly data: DataView;
};

export type SpaceMouseState = {
  readonly translation: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly range: number;
};

export type SpaceMouseReaderOptions = {
  readonly rotation?: () => boolean;
};

export type SpaceMouseReader = {
  readonly read: (report: SpaceMouseReport) => RawInput[];
  readonly reset: () => RawInput[];
};

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

const triple = (data: DataView): [number, number, number] => {
  const at = (offset: number) => (data.byteLength >= offset + 2 ? data.getInt16(offset, true) : 0);
  return [at(0), at(2), at(4)];
};

export function createSpaceMouseReader(options: SpaceMouseReaderOptions = {}): SpaceMouseReader {
  let translation: [number, number, number] = [0, 0, 0];
  let rotation: [number, number, number] = [0, 0, 0];
  let range = spaceMouseFullRange;
  let pulled = false;
  const down = new Set<number>();

  const axes = (): RawInput[] => {
    const tilt = options.rotation?.() === true;
    const x = clamp(-translation[0] / range) + (tilt ? clamp(-rotation[1] / range) : 0);
    const y = clamp(-translation[1] / range) + (tilt ? clamp(rotation[0] / range) : 0);
    const zoom = clamp(translation[2] / range);
    const out: RawInput[] = [{ kind: "axes", x: clamp(x), y: clamp(y), zoom }];
    return out;
  };

  const widen = (values: readonly number[]) => {
    for (const value of values) range = Math.max(range, Math.abs(value));
  };

  const released = (): RawInput[] => {
    if (!pulled) return [];
    pulled = false;
    return [{ kind: "button", name: "pull", down: false }];
  };

  const read = ({ reportId, data }: SpaceMouseReport): RawInput[] => {
    if (reportId === 1) {
      translation = triple(data);
      widen(translation);
      const full = clamp(translation[2] / range) <= -0.95;
      const out = axes();
      if (pulled && !full) out.push(...released());
      if (full) pulled = true;
      return out;
    }
    if (reportId === 2) {
      rotation = triple(data);
      widen(rotation);
      return axes();
    }
    if (reportId === 3) {
      const mask = data.byteLength > 0 ? data.getUint8(0) : 0;
      const out: RawInput[] = [];
      spaceMouseButtonNames.forEach((name, bit) => {
        const pressed = (mask & (1 << bit)) !== 0;
        if (pressed === down.has(bit)) return;
        if (pressed) {
          down.add(bit);
          out.push({ kind: "button", name });
        } else {
          down.delete(bit);
        }
      });
      return out;
    }
    return [];
  };

  const reset = (): RawInput[] => {
    translation = [0, 0, 0];
    rotation = [0, 0, 0];
    down.clear();
    return [...axes(), ...released()];
  };

  return { read, reset };
}

export type HidInputReportEvent = {
  readonly reportId: number;
  readonly data: DataView;
  readonly device: HidDeviceLike;
};

export type HidDeviceLike = {
  readonly vendorId: number;
  readonly productId: number;
  readonly opened: boolean;
  readonly collections?: readonly { readonly usagePage?: number; readonly usage?: number }[];
  readonly open: () => Promise<void>;
  readonly addEventListener: (
    type: "inputreport",
    listener: (event: HidInputReportEvent) => void,
  ) => void;
  readonly removeEventListener: (
    type: "inputreport",
    listener: (event: HidInputReportEvent) => void,
  ) => void;
};

export type HidLike = {
  readonly getDevices: () => Promise<readonly HidDeviceLike[]>;
  readonly requestDevice: (options: {
    filters: readonly { vendorId: number; usagePage: number; usage: number }[];
  }) => Promise<readonly HidDeviceLike[]>;
  readonly addEventListener: (type: "connect" | "disconnect", listener: () => void) => void;
  readonly removeEventListener: (type: "connect" | "disconnect", listener: () => void) => void;
};

export function hasWebHid(scope: object | undefined): boolean {
  if (scope === undefined || !("hid" in scope)) return false;
  return scope.hid !== undefined && scope.hid !== null;
}

export function isSpaceMouse(device: HidDeviceLike): boolean {
  if (!(spaceMouseVendorIds as readonly number[]).includes(device.vendorId)) return false;
  const collections = device.collections;
  if (collections === undefined || collections.length === 0) return true;
  return collections.some(
    (collection) =>
      collection.usagePage === spaceMouseUsagePage && collection.usage === spaceMouseUsage,
  );
}

export type SpaceMouseGrant = "granted" | "none" | "unsupported" | "cancelled";

export async function requestSpaceMouse(hid: HidLike | undefined): Promise<SpaceMouseGrant> {
  if (!hid) return "unsupported";
  try {
    const chosen = await hid.requestDevice({ filters: spaceMouseFilters });
    return chosen.some(isSpaceMouse) ? "granted" : "none";
  } catch {
    return "cancelled";
  }
}

export type SpaceMouseHost = {
  readonly hid: HidLike;
  readonly now: () => number;
  readonly focused: () => boolean;
  readonly rotation?: () => boolean;
};

export function bindSpaceMouse(input: CameraInput, host: SpaceMouseHost): () => void {
  const reader = createSpaceMouseReader(
    host.rotation === undefined ? {} : { rotation: host.rotation },
  );
  const attached = new Map<HidDeviceLike, (event: HidInputReportEvent) => void>();
  let last = host.now();
  let stopped = false;

  const push = (raws: RawInput[]) => {
    const now = host.now();
    const elapsed = now - last;
    last = now;
    for (const raw of raws) input.push(raw, elapsed);
  };

  const attach = async (device: HidDeviceLike) => {
    if (attached.has(device) || !isSpaceMouse(device)) return;
    const listener = (event: HidInputReportEvent) => {
      if (!host.focused()) {
        push(reader.reset());
        return;
      }
      push(reader.read({ reportId: event.reportId, data: event.data }));
    };
    attached.set(device, listener);
    device.addEventListener("inputreport", listener);
    try {
      if (!device.opened) await device.open();
    } catch {
      device.removeEventListener("inputreport", listener);
      attached.delete(device);
    }
  };

  const scan = async () => {
    try {
      const devices = await host.hid.getDevices();
      if (stopped) return;
      for (const device of devices) await attach(device);
    } catch {
      return;
    }
  };

  const onDisconnect = () => {
    push(reader.reset());
    void scan();
  };
  const onConnect = () => {
    void scan();
  };

  host.hid.addEventListener("connect", onConnect);
  host.hid.addEventListener("disconnect", onDisconnect);
  void scan();

  return () => {
    stopped = true;
    host.hid.removeEventListener("connect", onConnect);
    host.hid.removeEventListener("disconnect", onDisconnect);
    for (const [device, listener] of attached) device.removeEventListener("inputreport", listener);
    attached.clear();
    push(reader.reset());
  };
}
