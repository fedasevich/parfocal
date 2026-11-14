import { i18n, type Messages } from "@lingui/core";
import { messages as english } from "../locales/en.po";
import { type AppLocale, sourceLocale } from "./locale.ts";

const loaders: Record<Exclude<AppLocale, "en">, () => Promise<{ messages: Messages }>> = {
  cs: () => import("../locales/cs.po"),
  "en-XA": () => import("../locales/en-XA.po"),
};

i18n.load(sourceLocale, english);
i18n.activate(sourceLocale);

const loaded = new Set<string>([sourceLocale]);

export async function activateLocale(locale: AppLocale): Promise<void> {
  if (locale !== sourceLocale && !loaded.has(locale)) {
    const { messages } = await loaders[locale]();
    i18n.load(locale, messages);
    loaded.add(locale);
  }
  if (i18n.locale !== locale) i18n.activate(locale);
}

export { i18n };
