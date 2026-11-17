import { Trans, useLingui } from "@lingui/react/macro";
import { Loader } from "@parfocal/ui/components/loader";

export function StageOpening() {
  const { t } = useLingui();
  return (
    <div
      data-testid="stage-loading"
      className="pointer-events-none absolute inset-0 grid place-items-center"
    >
      <div className="flex items-center gap-2.5 rounded-ctl border border-line bg-chrome/90 px-3.5 py-2 text-body-sm text-fg-dim shadow-pop">
        <Loader label={t`Loading the slide`} size="inline" />
        <span aria-hidden="true">
          <Trans>Loading the slide</Trans>
        </span>
      </div>
    </div>
  );
}
