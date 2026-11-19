import { Trans, useLingui } from "@lingui/react/macro";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { useFormat } from "../format.ts";
import { CanvasNotice } from "../screens/review/guided-parts.tsx";
import { highPowerLevels, type StageIssue, stageIssueOf } from "./stage-issues.ts";
import type { VivRoute } from "./viewer-engine.ts";

const failedPollMs = 1000;

export function useFailedLevels(route: VivRoute | null): readonly number[] {
  const [levels, setLevels] = useState<readonly number[]>([]);
  useEffect(() => {
    if (route === null) return;
    const read = () => {
      const next = [
        ...new Set(
          route
            .failedTiles()
            .map((tile) => tile.level)
            .filter((level) => level < highPowerLevels),
        ),
      ].sort();
      setLevels((old) =>
        old.length === next.length && old.every((level, index) => level === next[index])
          ? old
          : next,
      );
    };
    read();
    const timer = window.setInterval(read, failedPollMs);
    return () => window.clearInterval(timer);
  }, [route]);
  return levels;
}

export function SignedOffNotice({
  at,
  researcher,
  onAsk,
}: {
  at: string | null;
  researcher: string | undefined;
  onAsk: () => void;
}) {
  const format = useFormat();
  const day = at === null ? null : format.dateShort(new Date(at));
  return (
    <Banner
      tone="info"
      icon="lock"
      data-testid="signed-off-notice"
      actions={
        <Button size="sm" onClick={onAsk}>
          {researcher === undefined ? (
            <Trans>Ask the researcher to amend</Trans>
          ) : (
            <Trans>Ask {researcher} to amend</Trans>
          )}
        </Button>
      }
    >
      {day === null ? (
        <Trans>
          <b>Signed off.</b> Changes need an amendment.
        </Trans>
      ) : (
        <Trans>
          <b>Signed off {day}.</b> Changes need an amendment.
        </Trans>
      )}
    </Banner>
  );
}

export function useAnswersOff(
  issue: StageIssue | null,
  signedOff: boolean,
  slideLabel: string,
): string | undefined {
  const { t } = useLingui();
  if (signedOff) return t`Signed off. Ask the researcher to amend.`;
  if (issue === "withdrawn") return t`This task was withdrawn. There is nothing left to decide.`;
  if (issue === "slidefail")
    return t`${slideLabel} can't be read at the highest magnifications yet. Retry, or ask the researcher.`;
  if (issue === "noresults") return t`Nothing to decide here yet.`;
  return undefined;
}

export function StageIssueCard({
  issue,
  slideLabel,
  onRetry,
  onAsk,
  onNext,
}: {
  issue: StageIssue;
  slideLabel: string;
  onRetry: () => void;
  onAsk: () => void;
  onNext: (() => void) | null;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const ask = (
    <Button onClick={onAsk}>
      <Trans>Ask the researcher</Trans>
    </Button>
  );
  return (
    <div data-testid="stage-issue" data-issue={issue} className="contents">
      {issue === "slidefail" ? (
        <CanvasNotice
          icon="warn"
          title={t`${slideLabel} could not be read at the highest magnifications.`}
          actions={
            <>
              <Button variant="primary" onClick={onRetry}>
                <Trans>Retry</Trans>
              </Button>
              {ask}
            </>
          }
        >
          <Trans>
            Tiles are missing on the server. Lower magnifications still show, and your other slides
            work.
          </Trans>
        </CanvasNotice>
      ) : issue === "withdrawn" ? (
        <CanvasNotice
          icon="info"
          title={t`This task was withdrawn.`}
          actions={
            <Button variant="primary" onClick={() => void navigate({ to: "/my-work" })}>
              <Trans>Back to My work</Trans>
            </Button>
          }
        >
          <Trans>Your decided slides are kept and show in the report.</Trans>
        </CanvasNotice>
      ) : (
        <CanvasNotice
          icon="smart"
          title={t`No AI result on ${slideLabel} yet.`}
          actions={
            <>
              {onNext === null ? null : (
                <Button variant="primary" onClick={onNext}>
                  <Trans>Next slide</Trans>
                </Button>
              )}
              {ask}
            </>
          }
        >
          <Trans>Review the slide without AI, or ask the researcher to run the model.</Trans>
        </CanvasNotice>
      )}
    </div>
  );
}

export function StageIssueLayer({
  route,
  taskGone,
  resultMissing,
  signedOff,
  slideLabel,
  onAsk,
  onNext,
  children,
}: {
  route: VivRoute | null;
  taskGone: boolean;
  resultMissing: boolean;
  signedOff: boolean;
  slideLabel: string;
  onAsk: () => void;
  onNext: (() => void) | null;
  children: (answersOff: string | undefined) => ReactNode;
}) {
  const failedLevels = useFailedLevels(route);
  const issue = stageIssueOf({ taskGone, failedLevels, resultMissing });
  const answersOff = useAnswersOff(issue, signedOff, slideLabel);
  const retry = () => {
    for (const tile of route?.failedTiles() ?? []) route?.retryTile(tile.key);
  };
  return (
    <>
      {issue === null ? null : (
        <StageIssueCard
          issue={issue}
          slideLabel={slideLabel}
          onRetry={retry}
          onAsk={onAsk}
          onNext={onNext}
        />
      )}
      {children(answersOff)}
    </>
  );
}
