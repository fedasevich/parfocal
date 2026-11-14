export const sourceLocale = "en";
export const pseudoLocale = "en-XA";
export const pseudoLocaleKey = "parfocal.pseudo-locale";

export type AppLocale = "en" | "cs" | "en-XA";

export function localeFor(language: "en" | "cs" | undefined, pseudo: boolean): AppLocale {
  if (pseudo) return pseudoLocale;
  return language ?? sourceLocale;
}

export function pseudoRequested(storage: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return storage?.getItem(pseudoLocaleKey) === "1";
  } catch {
    return false;
  }
}

const plainLetters = /[A-Za-z]{2}/;
const placeholder = /\{[^}]*\}|<\/?\d+\/?>/g;

export function hasPlainLetters(text: string): boolean {
  return plainLetters.test(text.replace(placeholder, ""));
}
