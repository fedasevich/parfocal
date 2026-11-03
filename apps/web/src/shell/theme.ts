import { resolveSetting } from "@parfocal/api-client";
import { effectiveTheme, lightSchemeQuery, type ThemeChoice, themeChoice } from "@parfocal/tokens";
import { type DeviceStorage, readDeviceSettings, writeDeviceSetting } from "./device-settings.ts";

export type { ThemeChoice };

const prefersLight = () =>
  typeof window.matchMedia === "function" && window.matchMedia(lightSchemeQuery).matches;

export function readTheme(storage?: DeviceStorage): ThemeChoice {
  const device = storage === undefined ? readDeviceSettings() : readDeviceSettings(storage);
  return themeChoice(
    resolveSetting("theme", { lab: { values: {}, locked: [] }, personal: {}, device }).value,
  );
}

export function applyTheme(
  choice: ThemeChoice,
  root: HTMLElement = document.documentElement,
  light: boolean = prefersLight(),
): void {
  root.dataset["theme"] = effectiveTheme(choice, light);
}

export function chooseTheme(choice: ThemeChoice): void {
  writeDeviceSetting("theme", choice);
  applyTheme(choice);
}

export function installTheme(): void {
  applyTheme(readTheme());
  if (typeof window.matchMedia !== "function") return;
  window.matchMedia(lightSchemeQuery).addEventListener("change", (event) => {
    const choice = readTheme();
    if (choice === "system") applyTheme(choice, document.documentElement, event.matches);
  });
}
