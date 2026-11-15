import { i18n } from "@lingui/core";
import { compileMessage } from "@lingui/message-utils/compileMessage";
import { I18nProvider } from "@lingui/react";
import type { ReactNode } from "react";

i18n.setMessagesCompiler(compileMessage);
i18n.load("en", {});
i18n.activate("en");

export function StoryI18n({ children }: { children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
