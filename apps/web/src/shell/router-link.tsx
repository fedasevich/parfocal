import type { LinkRenderer } from "@parfocal/ui/components/app-shell";
import { useRouter } from "@tanstack/react-router";
import type { MouseEvent } from "react";

const opensElsewhere = (event: MouseEvent) =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

export function useGoTo() {
  const router = useRouter();
  return (href: string) => router.navigate({ href });
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
