import { Trans, useLingui } from "@lingui/react/macro";
import { Loader } from "@parfocal/ui/components/loader";

const productName = "Parfocal";

export function BootLoader() {
  const { t } = useLingui();
  return (
    <div data-testid="boot-loader" className="fixed inset-0">
      <Loader label={t`Loading ${productName}`} size="page" />
    </div>
  );
}

export function SignInPrompt({ href }: { href: string }) {
  return (
    <div
      className="fixed inset-0 grid place-content-center justify-items-center gap-3.5 bg-page text-title font-semibold text-fg-dim"
      data-testid="sign-in-needed"
    >
      <span>{productName}</span>
      <a href={href} className="text-body-sm text-accent underline">
        <Trans>Sign in to go on</Trans>
      </a>
    </div>
  );
}
