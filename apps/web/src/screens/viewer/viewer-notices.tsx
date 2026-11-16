import { Trans, useLingui } from "@lingui/react/macro";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { TileHint } from "@parfocal/ui/components/visualize";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ConnectionBanner } from "../../shell/connection-banner.tsx";
import { destinations } from "../../shell/destinations.ts";
import { CanvasNotice } from "../review/guided-parts.tsx";
import type { ViewerSetup } from "./viewer-scenes.ts";

export function ViewerBanner({
  setup,
  online,
  readOnly,
  researcherName,
  slideLabel,
}: {
  setup: ViewerSetup;
  online: boolean;
  readOnly: boolean;
  researcherName: string | undefined;
  slideLabel: string;
}) {
  const router = useRouter();
  return setup.connLost || !online ? (
    <ConnectionBanner pinned={setup.connLost} />
  ) : readOnly ? (
    <Banner
      tone="info"
      icon="lock"
      actions={
        <Button size="sm">
          {researcherName === undefined ? (
            <Trans>Ask the researcher to amend</Trans>
          ) : (
            <Trans>Ask {researcherName} to amend</Trans>
          )}
        </Button>
      }
    >
      <Trans>
        <b>Signed off 15 Oct.</b> Changes need an amendment.
      </Trans>
    </Banner>
  ) : setup.sourceOff ? (
    <Banner
      tone="warn"
      icon="link"
      actions={
        <Button
          size="sm"
          onClick={() => void router.navigate({ href: `${destinations.admin()}?section=storage` })}
        >
          <Trans>Source status</Trans>
        </Button>
      }
    >
      <Trans>
        <b>Scanner archive is not answering since 10:40.</b> {slideLabel} is read in place from
        there, so it opens from the 7-day tile cache. Places never viewed show a quiet checker until
        the source is back.
      </Trans>
    </Banner>
  ) : null;
}

export function ViewerCanvasNotice({
  setup,
  slideLabel,
  setName,
  taskCodeOrThe,
  withdrawnBy,
  withdrawnTask,
}: {
  setup: ViewerSetup;
  slideLabel: string;
  setName: string;
  taskCodeOrThe: string;
  withdrawnBy: string;
  withdrawnTask: string;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  return setup.issue === "slidefail" ? (
    <CanvasNotice
      icon="warn"
      title={t`${slideLabel} could not be read at 20x and 40x.`}
      actions={
        <>
          <Button variant="primary">
            <Trans>Retry</Trans>
          </Button>
          <Button>
            <Trans>Ask the researcher</Trans>
          </Button>
        </>
      }
    >
      <Trans>
        Tiles are missing on the server. Lower magnifications still show, and your other slides
        work.
      </Trans>
    </CanvasNotice>
  ) : setup.issue === "withdrawn" ? (
    <CanvasNotice
      icon="info"
      title={t`${taskCodeOrThe} was withdrawn.`}
      actions={
        <Button variant="primary" onClick={() => void navigate({ to: "/my-work" })}>
          <Trans>Back to My work</Trans>
        </Button>
      }
    >
      <Trans>
        {withdrawnBy} withdrew {withdrawnTask} on 16 Oct. Your 7 decided slides are kept and show in
        the report.
      </Trans>
    </CanvasNotice>
  ) : setup.issue === "noresults" ? (
    <CanvasNotice
      icon="smart"
      title={t`No ${setName} result on ${slideLabel} yet.`}
      actions={
        <Button>
          <Trans>Ask the researcher</Trans>
        </Button>
      }
    >
      <Trans>Look at the slide without AI, or ask the researcher to run the model.</Trans>
    </CanvasNotice>
  ) : null;
}

export function ViewerTileHint({ setup }: { setup: ViewerSetup }) {
  const { t } = useLingui();
  const router = useRouter();
  return setup.tileHint === "loading" ? (
    <TileHint percent={40}>{t`Loading sharper tiles · 12 left`}</TileHint>
  ) : setup.tileHint === "unloaded" ? (
    <TileHint percent={6}>{t`Loading the slide`}</TileHint>
  ) : setup.tileHint === "slow" ? (
    <TileHint
      className="w-112"
      percent={70}
      action={
        <Button
          size="sm"
          onClick={() => void router.navigate({ href: `${destinations.admin()}?section=storage` })}
        >
          <Trans>Source status</Trans>
        </Button>
      }
    >
      <Trans>
        <b>Slow source.</b> The scanner archive answers in 2.4 s. Keep reading, the view sharpens as
        tiles arrive. Lower magnifications come first.
      </Trans>
    </TileHint>
  ) : null;
}
