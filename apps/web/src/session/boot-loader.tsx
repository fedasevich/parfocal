import { Trans, useLingui } from "@lingui/react/macro";

const productName = "Parfocal";

export function BootLoader() {
  const { t } = useLingui();
  return (
    <div
      className="boot-loader"
      data-testid="boot-loader"
      role="status"
      aria-label={t`Loading ${productName}`}
    >
      <span>{productName}</span>
      <span className="boot-loader-bar" />
    </div>
  );
}

export function SignInPrompt({ href }: { href: string }) {
  return (
    <div className="boot-loader" data-testid="sign-in-needed">
      <span>{productName}</span>
      <a href={href} className="text-body-sm text-accent underline">
        <Trans>Sign in to go on</Trans>
      </a>
    </div>
  );
}
