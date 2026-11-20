import { Trans, useLingui } from "@lingui/react/macro";
import type { ResultSet } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { IntoTopStack } from "@parfocal/ui/components/top-stack";
import type { ReactNode } from "react";
import { andJoin } from "../screens/format.ts";
import { resultSetStates } from "./result-set-state.ts";
import { type SlideNoticeKind, slideNoticesOf } from "./slide-notices.ts";
import type { SlideStorageNote } from "./tile-grant.ts";
import type { ViewerMode } from "./viewer-mode.ts";

type SlideNoticeListProps = {
  storage: SlideStorageNote | null;
  resultSets: readonly ResultSet[];
  noResult: boolean;
  micronsPerPixel: number | null | undefined;
  slideLabel: string;
  onNext: (() => void) | null;
  onAsk: () => void;
  modeFallback?: ModeFallback | undefined;
};

export type ModeFallback = {
  readonly asked: ViewerMode;
  readonly shown: ViewerMode;
  readonly noCellSample: boolean;
};

function Line({
  kind,
  icon,
  tone,
  testId,
  state,
  children,
  actions,
}: {
  kind: SlideNoticeKind;
  icon: "warn" | "clock" | "link" | "smart" | "ruler";
  tone: "warn" | "dim";
  testId?: string | undefined;
  state?: string | undefined;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li
      data-notice={kind}
      data-testid={testId}
      data-state={state}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
    >
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <Icon name={icon} className={tone === "warn" ? "mt-0.5 text-warn" : "mt-0.5 text-fg-dim"} />
        <span className="min-w-0">{children}</span>
      </span>
      {actions === undefined ? null : <span className="flex gap-2">{actions}</span>}
    </li>
  );
}

export function SlideNoticeList({
  storage,
  resultSets,
  noResult,
  micronsPerPixel,
  slideLabel,
  onNext,
  onAsk,
  modeFallback,
}: SlideNoticeListProps) {
  const { t } = useLingui();
  const modeWords: Record<ViewerMode, string> = {
    look: t`Look`,
    review: t`Review`,
    guided: t`Guided`,
    cells: t`Cells`,
    annotate: t`Annotate`,
  };
  const states = resultSetStates(resultSets);
  const kinds = slideNoticesOf({
    remoteOffline: storage?.storage === "remote" && storage.offline,
    noResult,
    resultSets: states,
    micronsPerPixel,
    modeFallback: modeFallback !== undefined,
  });
  if (kinds.length === 0) return null;
  const failed = states?.failed ?? [];
  const importing = states?.importing ?? [];
  const line = (kind: SlideNoticeKind) => {
    switch (kind) {
      case "mode-fallback":
        return (
          <Line key={kind} kind={kind} icon="warn" tone="dim" testId="mode-fallback">
            {modeFallback?.noCellSample === true
              ? t`This slide has no cell sample, so it opened in ${modeWords[modeFallback.shown]}.`
              : t`This slide cannot open in ${modeWords[modeFallback?.asked ?? "review"]} here, so it opened in ${modeWords[modeFallback?.shown ?? "review"]}.`}
          </Line>
        );
      case "remote-offline":
        return (
          <Line key={kind} kind={kind} icon="link" tone="warn" testId="remote-offline">
            <Trans>
              <b>The source of this slide is not answering.</b> The slide opens from the 7-day tile
              cache. Places never viewed stay empty until the source is back.
            </Trans>
          </Line>
        );
      case "no-result":
        return (
          <Line
            key={kind}
            kind={kind}
            icon="smart"
            tone="dim"
            testId="no-result-notice"
            actions={
              <>
                {onNext === null ? null : (
                  <Button size="sm" variant="primary" onClick={onNext}>
                    <Trans>Next slide</Trans>
                  </Button>
                )}
                <Button size="sm" onClick={onAsk}>
                  <Trans>Ask the researcher</Trans>
                </Button>
              </>
            }
          >
            <b>{t`No AI result on ${slideLabel} yet.`}</b>{" "}
            <Trans>Review the slide without AI, or ask the researcher to run the model.</Trans>
          </Line>
        );
      case "result-failed":
        return (
          <Line
            key={kind}
            kind={kind}
            icon="warn"
            tone="warn"
            testId="result-set-notice"
            state="failed"
          >
            {failed.length === 1
              ? t`The result set ${andJoin(failed)} did not import, so its objects are not shown.`
              : t`The result sets ${andJoin(failed)} did not import, so their objects are not shown.`}
          </Line>
        );
      case "result-importing":
        return (
          <Line
            key={kind}
            kind={kind}
            icon="clock"
            tone="dim"
            testId={failed.length > 0 ? undefined : "result-set-notice"}
            state="importing"
          >
            {importing.length === 1
              ? t`The result set ${andJoin(importing)} is still importing. Its objects show when it is ready.`
              : t`The result sets ${andJoin(importing)} are still importing. Their objects show when they are ready.`}
          </Line>
        );
      case "no-pixel-size":
        return (
          <Line key={kind} kind={kind} icon="ruler" tone="dim" testId="no-pixel-size">
            <Trans>
              This slide has no pixel size, so lengths and areas show in pixels and areas get no
              size category.
            </Trans>
          </Line>
        );
    }
  };
  return (
    <IntoTopStack order="wait">
      <ul
        aria-label={t`About this slide`}
        data-testid="slide-notices"
        data-notices={kinds.join(" ")}
        className="m-0 grid list-none gap-1.5 rounded-md border border-line bg-chrome px-3 py-2 text-caption shadow-sm"
      >
        {kinds.map(line)}
      </ul>
    </IntoTopStack>
  );
}
