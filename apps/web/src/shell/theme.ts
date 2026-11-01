export type ThemeChoice = "dark" | "light" | "system";

const storageKey = "parfocal-theme";

const systemTheme = () =>
  window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

export function readTheme(): ThemeChoice {
  const stored = window.localStorage.getItem(storageKey);
  return stored === "light" || stored === "system" ? stored : "dark";
}

export function applyTheme(choice: ThemeChoice): void {
  window.localStorage.setItem(storageKey, choice);
  document.documentElement.dataset["theme"] = choice === "system" ? systemTheme() : choice;
}
