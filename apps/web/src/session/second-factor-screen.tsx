import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { reauthUrl, secondFactorSetupUrl } from "./lock-rules.ts";

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export default function SecondFactorScreen() {
  const { t } = useLingui();
  return (
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-[color-mix(in_srgb,var(--page)_55%,transparent)] backdrop-blur-[22px] backdrop-saturate-[.6]">
      <section
        aria-label={t`Second factor needed`}
        className="flex w-96 flex-col items-center gap-3.5 rounded-xl border border-line bg-chrome p-7 text-center"
      >
        <Icon name="key" className="text-fg-dim" />
        <b className="text-title-sm text-fg">
          <Trans>This workspace asks for a second factor</Trans>
        </b>
        <p className="text-body-sm text-fg-dim">
          <Trans>
            Set up an authenticator app or a security key in your account, then sign in again with
            it.
          </Trans>
        </p>
        <div className="grid w-full gap-2">
          <Button
            variant="primary"
            className="w-full"
            onClick={() => window.location.assign(secondFactorSetupUrl)}
          >
            <Trans>Set up a second factor</Trans>
          </Button>
          <Button
            className="w-full"
            onClick={() => window.location.assign(reauthUrl(currentPath()))}
          >
            <Trans>Sign in again</Trans>
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => window.location.assign("/api/auth/logout")}
          >
            <Trans>Log out</Trans>
          </Button>
        </div>
      </section>
    </div>
  );
}
