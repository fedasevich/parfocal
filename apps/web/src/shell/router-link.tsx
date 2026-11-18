import type { LinkRenderer } from "@parfocal/ui/components/app-shell";
import { useRouter } from "@tanstack/react-router";
import type { MouseEvent } from "react";
import { destinations } from "./destinations.ts";
import { settingsSectionOfHref, useOpenSettings } from "./settings-overlay.tsx";
import { shellStore } from "./shell-store.ts";

const opensElsewhere = (event: MouseEvent) =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

export function useGoTo() {
  const router = useRouter();
  const openSettings = useOpenSettings();
  return (href: string) => {
    if (href === destinations.newProject()) {
      shellStore.setState({ newProjectOpen: true });
      return Promise.resolve();
    }
    const section = settingsSectionOfHref(href);
    if (section) return openSettings(section);
    return router.navigate({ href });
  };
}

export function useRouterLink(): LinkRenderer {
  const goTo = useGoTo();
  return ({ href, children, ...props }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        if (opensElsewhere(event)) return;
        event.preventDefault();
        void goTo(href);
      }}
    >
      {children}
    </a>
  );
}
