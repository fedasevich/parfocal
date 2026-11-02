import {
  catalogue,
  type Layer,
  type SettingEntry,
  type SettingKey,
  type SettingValues,
} from "./catalogue.generated.ts";

export type StoredValues = Partial<Record<string, unknown>>;

export type SettingLayers = {
  lab: { values: StoredValues; locked: readonly string[] };
  personal: StoredValues;
  device: StoredValues;
};

export type Source = "lab-locked" | Layer | "default";

export type Resolved<K extends SettingKey> = {
  value: SettingValues[K];
  source: Source;
  locked: boolean;
};

const fits = (entry: SettingEntry, value: unknown): boolean => {
  switch (entry.kind) {
    case "choice":
      return typeof value === "string" && (entry.options ?? []).includes(value);
    case "switch":
      return typeof value === "boolean";
    case "whole":
      return (
        Number.isInteger(value) &&
        (entry.minimum === undefined || (value as number) >= entry.minimum) &&
        (entry.maximum === undefined || (value as number) <= entry.maximum)
      );
  }
};

const usable = (entry: SettingEntry, layer: Layer, values: StoredValues, key: string): boolean =>
  entry.layers.includes(layer) && key in values && fits(entry, values[key]);

export const resolveSetting = <K extends SettingKey>(
  key: K,
  layers: SettingLayers,
): Resolved<K> => {
  const entry = catalogue[key];
  const found = (value: unknown, source: Source, locked = false): Resolved<K> => ({
    value: value as SettingValues[K],
    source,
    locked,
  });
  const lab = usable(entry, "lab", layers.lab.values, key);
  if (lab && layers.lab.locked.includes(key)) {
    return found(layers.lab.values[key], "lab-locked", true);
  }
  if (usable(entry, "personal", layers.personal, key)) {
    return found(layers.personal[key], "personal");
  }
  if (usable(entry, "device", layers.device, key)) {
    return found(layers.device[key], "device");
  }
  if (lab) {
    return found(layers.lab.values[key], "lab");
  }
  return found(entry.default, "default");
};

export const resolveSettings = (layers: SettingLayers): SettingValues =>
  Object.fromEntries(
    (Object.keys(catalogue) as SettingKey[]).map((key) => [key, resolveSetting(key, layers).value]),
  ) as SettingValues;
