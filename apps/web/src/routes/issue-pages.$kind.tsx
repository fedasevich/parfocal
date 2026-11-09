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
        projectName="Lung biopsies"
        ownerName="Dana Reyes"
        asked={asked}
        onAsk={() => setAsked(true)}
      />
    );
  }
  if (kind === "styles") {
    return (
      <main className="grid max-w-xl gap-4 p-8">
        <h1 className="m-0 text-page-title">Issue styles</h1>
        <Banner tone="warn" actions={<Button size="sm">Retry now</Button>}>
          <b>Connection lost.</b> Saving is paused.
        </Banner>
        <Banner inline tone="info" icon="lock">
          <b>Signed off.</b> Changes need an amendment.
        </Banner>
        <Banner inline tone="bad">
          The export failed.
        </Banner>
        <label className="grid gap-1 text-body-sm">
          Due date
          <input aria-describedby="due-error" aria-invalid defaultValue="2020-01-01" />
        </label>
        <InlineError id="due-error" actions={<Button variant="link">Pick a later date</Button>}>
          The due date is in the past.
        </InlineError>
      </main>
    );
  }
  throw notFound();
}
