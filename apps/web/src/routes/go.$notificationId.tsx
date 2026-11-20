import { Trans, useLingui } from "@lingui/react/macro";
import { useGetNotificationTarget } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Loader } from "@parfocal/ui/components/loader";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { okData } from "../screens/placeholder.tsx";
import { GoHome, IssuePage } from "../shell/issue-pages.tsx";
import { targetHref } from "../shell/notification-target.ts";

export const Route = createFileRoute("/go/$notificationId")({
  component: OpenNotification,
});

function OpenNotification() {
  const { t } = useLingui();
  const router = useRouter();
  const { notificationId } = Route.useParams();
  const query = useGetNotificationTarget(notificationId, { query: { retry: false } });
  const target = okData(query.data);
  const href = target === undefined ? null : targetHref(target);
  useEffect(() => {
    if (href !== null) void router.navigate({ href, replace: true });
  }, [href, router]);
  if (query.isPending || href !== null) {
    return <Loader label={t`Opening the notification`} size="page" />;
  }
  return <NotificationGonePage />;
}

function NotificationGonePage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  return (
    <IssuePage
      testId="issue-notification-gone"
      icon="bell"
      title={t`This notification cannot be opened`}
      happened={t`What it points at was deleted, or it is no longer open to you.`}
      stillWorks={t`Your other notifications and your work are not affected.`}
      actions={
        <>
          <Button variant="primary" onClick={() => void navigate({ to: "/notifications" })}>
            <Trans>See all notifications</Trans>
          </Button>
          <GoHome />
        </>
      }
    />
  );
}
