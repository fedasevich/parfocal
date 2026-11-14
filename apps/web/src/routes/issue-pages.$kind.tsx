import { Trans, useLingui } from "@lingui/react/macro";
import { Banner, InlineError } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import {
  NoAccessPage,
  NotFoundPage,
  ServerErrorPage,
  SessionExpiredPage,
} from "../shell/issue-pages.tsx";

export const Route = createFileRoute("/issue-pages/$kind")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: IssuePagePreview,
});

function IssuePagePreview() {
  const { t } = useLingui();

  const { kind } = Route.useParams();
  const [asked, setAsked] = useState(false);
  if (kind === "not-found") return <NotFoundPage />;
  if (kind === "server-error") return <ServerErrorPage reference="E-4F2A" />;
  if (kind === "expired") {
    return <SessionExpiredPage hours={8} lastSaved="11:02" onSignIn={() => undefined} />;
  }
  if (kind === "no-access") {
    return (
      <NoAccessPage
        projectName={t`Lung biopsies`}
        ownerName="Dana Reyes"
        asked={asked}
        onAsk={() => setAsked(true)}
      />
    );
  }
  if (kind === "styles") {
    return (
      <main className="grid max-w-xl gap-4 p-8">
        <h1 className="m-0 text-page-title">
          <Trans>Issue styles</Trans>
        </h1>
        <Banner
          tone="warn"
          actions={
            <Button size="sm">
              <Trans>Retry now</Trans>
            </Button>
          }
        >
          <Trans>
            <b>Connection lost.</b> Saving is paused.
          </Trans>
        </Banner>
        <Banner inline tone="info" icon="lock">
          <Trans>
            <b>Signed off.</b> Changes need an amendment.
          </Trans>
        </Banner>
        <Banner inline tone="bad">
          <Trans>The export failed.</Trans>
        </Banner>
        <label className="grid gap-1 text-body-sm">
          <Trans>Due date</Trans>
          <input aria-describedby="due-error" aria-invalid defaultValue="2020-01-01" />
        </label>
        <InlineError
          id="due-error"
          actions={
            <Button variant="link">
              <Trans>Pick a later date</Trans>
            </Button>
          }
        >
          <Trans>The due date is in the past.</Trans>
        </InlineError>
      </main>
    );
  }
  throw notFound();
}
