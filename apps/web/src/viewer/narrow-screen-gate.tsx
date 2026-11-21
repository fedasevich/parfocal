import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useSyncExternalStore } from "react";
import { IssuePage } from "../shell/issue-pages.tsx";

export const narrowScreenQuery = "(max-width: 639px)";

const subscribe = (notify: () => void) => {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(narrowScreenQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};

const read = () =>
  typeof window.matchMedia === "function" && window.matchMedia(narrowScreenQuery).matches;

export function useNarrowScreen(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

export function NarrowScreenGate({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  if (!useNarrowScreen()) return children;
  return (
    <IssuePage
      testId="narrow-screen-notice"
      icon="monitor"
      title={t`Review needs a wider screen`}
      happened={t`The slide, its objects and the decision panel do not fit on a phone screen.`}
      stillWorks={t`Open this task on a tablet or a computer. Everything you decided so far is saved.`}
      actions={
        <Button variant="primary" onClick={() => void navigate({ to: "/my-work" })}>
          <Trans>Back to My work</Trans>
        </Button>
      }
    />
  );
}
