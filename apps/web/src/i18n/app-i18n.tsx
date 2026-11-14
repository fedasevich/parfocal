import { I18nProvider } from "@lingui/react";
import { type ReactNode, useEffect } from "react";
import { useSignedInArea } from "../session/signed-in-area.ts";
import { useResolvedSettings } from "../shell/resolved-settings.ts";
import { activateLocale, i18n } from "./i18n.ts";
import { localeFor, pseudoRequested } from "./locale.ts";

const pseudo = import.meta.env.DEV && pseudoRequested(globalThis.localStorage);

export function AppI18n({ children }: { children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

export function useAppliedLocale(): void {
  const enabled = useSignedInArea();
  const language = useResolvedSettings(enabled)?.language;
  const locale = localeFor(language, pseudo);
  useEffect(() => {
    void activateLocale(locale);
  }, [locale]);
}
