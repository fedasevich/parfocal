import {
  type DeviceStorage,
  readDeviceSettings,
  writeDeviceSetting,
} from "../shell/device-settings.ts";

export type Calibration = { deadZone: number; speed: number };

export const calibrationKey = "calibration";

export const calibrationDefaults: Calibration = { deadZone: 10, speed: 60 };

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, Math.round(value)));

const sanitized = (raw: unknown): Calibration => {
  const entry = typeof raw === "object" && raw !== null ? (raw as Partial<Calibration>) : {};
  return {
    deadZone: Number.isFinite(entry.deadZone)
      ? clamp(entry.deadZone as number, 0, 50)
      : calibrationDefaults.deadZone,
    speed: Number.isFinite(entry.speed)
      ? clamp(entry.speed as number, 10, 200)
      : calibrationDefaults.speed,
  };
};

const allCalibrations = (storage?: DeviceStorage): Record<string, unknown> => {
  const stored = readDeviceSettings(storage)[calibrationKey];
  return typeof stored === "object" && stored !== null && !Array.isArray(stored)
    ? (stored as Record<string, unknown>)
    : {};
};

export function readCalibration(device: string, storage?: DeviceStorage): Calibration {
  return sanitized(allCalibrations(storage)[device]);
}

export function writeCalibration(
  device: string,
  change: Partial<Calibration>,
  storage?: DeviceStorage,
): Calibration {
  const next = sanitized({ ...readCalibration(device, storage), ...change });
  writeDeviceSetting(calibrationKey, { ...allCalibrations(storage), [device]: next }, storage);
  return next;
}

export function applyDeadZone(axis: number, deadZone: number): number {
  const edge = deadZone / 100;
  const size = Math.abs(axis);
  if (size <= edge) return 0;
  return Math.sign(axis) * Math.min(1, (size - edge) / (1 - edge));
}

export function speedFactor(speed: number): number {
  return speed / calibrationDefaults.speed;
}
