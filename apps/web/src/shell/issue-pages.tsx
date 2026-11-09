import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

type IssuePageProps = {
  icon: IconName;
  title: string;
  happened: ReactNode;
  stillWorks: ReactNode;
  actions: ReactNode;
  testId: string;
};

function IssuePage({ icon, title, happened, stillWorks, actions, testId }: IssuePageProps) {
  return (
    <main data-testid={testId} className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-16 text-fg">
      <Icon name={icon} size="lg" className="text-fg-dim" />
      <h1 className="m-0 font-semibold text-page-title">{title}</h1>
      <Banner inline tone="info" icon={icon}>
        {happened}
      </Banner>
      <p className="m-0 text-body text-fg-dim">{stillWorks}</p>
      <div className="flex flex-wrap items-center gap-3">{actions}</div>
    </main>
  );
}

function GoHome({ primary = false }: { primary?: boolean }) {
  const navigate = useNavigate();
  return (
    <Button variant={primary ? "primary" : "secondary"} onClick={() => void navigate({ to: "/" })}>
      Go home
    </Button>
  );
}

export function NotFoundPage() {
  return (
    <IssuePage
      testId="issue-not-found"
      icon="search"
      title="Page not found"
      happened="This page does not exist, or it was moved or deleted."
      stillWorks="Everything else in Parfocal works and nothing was changed."
      actions={<GoHome primary />}
    />
  );
}

export function ServerErrorPage({ reference }: { reference?: string }) {
  return (
    <IssuePage
      testId="issue-server-error"
      icon="warn"
      title="Something went wrong on our side"
      happened={
        <>
          The page could not be shown.
          {reference ? <> Reference {reference}.</> : null}
        </>
      }
      stillWorks="What you already saved is safe, and other pages still work."
      actions={
        <>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Try again
          </Button>
          <GoHome />
        </>
      }
    />
  );
}

export function SessionExpiredPage({
  hours,
  lastSaved,
  onSignIn,
}: {
  hours: number;
  lastSaved: string;
  onSignIn: () => void;
}) {
  return (
    <IssuePage
      testId="issue-session-expired"
      icon="clock"
      title="Your session ended"
      happened={`Your session ended after ${hours} hours.`}
      stillWorks={`Everything you saved is kept. Your last save was ${lastSaved}.`}
      actions={
        <Button variant="primary" onClick={onSignIn}>
          Sign in to go on
        </Button>
      }
    />
  );
}

export function NoAccessPage({
  projectName,
  ownerName,
  asked,
  onAsk,
}: {
  projectName: string;
  ownerName: string;
  asked: boolean;
  onAsk: () => void;
}) {
  return (
    <IssuePage
      testId="issue-no-access"
      icon="lock"
      title={`No access to ${projectName}`}
      happened={`You are not a member of ${projectName}. Its owner is ${ownerName}.`}
      stillWorks="Your other projects and your work are not affected."
      actions={
        <>
          {asked ? (
            <Button variant="primary" disabled>
              <Icon name="check" />
              Asked {ownerName}
            </Button>
          ) : (
            <Button variant="primary" onClick={onAsk}>
              Ask for access
            </Button>
          )}
          <GoHome />
        </>
      }
    />
  );
}
