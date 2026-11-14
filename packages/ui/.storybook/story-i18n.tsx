import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ReactNode } from "react";
import { messages } from "../../../apps/web/src/locales/en.po";

i18n.load("en", messages);
i18n.activate("en");

export function StoryI18n({ children }: { children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
