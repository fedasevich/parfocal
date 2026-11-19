import { Trans, useLingui } from "@lingui/react/macro";
import { useListNotifications, useMarkNotificationsRead } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { NotificationRow } from "@parfocal/ui/components/notifications-panel";
import { SkeletonRows } from "@parfocal/ui/components/skeleton";
import { useState } from "react";
import { toNotification, useInboxRefresh } from "../../shell/bell.tsx";
import { useGoTo } from "../../shell/router-link.tsx";
import { okData } from "../placeholder.tsx";

export const defaultPageSize = 25;

function NotificationsPage({
  cursor,
  size,
  onOpen,
}: {
  cursor: string | undefined;
  size: number;
  onOpen: (id: string, link: string, read: boolean) => void;
}) {
  const { t } = useLingui();
  const [more, setMore] = useState(false);
  const query = useListNotifications({ limit: size, ...(cursor ? { cursor } : {}) });
  const page = okData(query.data);
  if (page === undefined) {
    return (
      <li className="p-4">
        <SkeletonRows rows={4} columns={2} label={t`Loading notifications`} />
      </li>
    );
  }
  return (
    <>
      {page.notifications.map((item) => (
        <NotificationRow
          key={item.id}
          item={toNotification(item)}
          onOpen={() => onOpen(item.id, item.link, item.read)}
        />
      ))}
      {page.next_cursor && !more ? (
        <li className="px-4 py-3">
          <Button onClick={() => setMore(true)}>
            <Trans>Show older</Trans>
          </Button>
        </li>
      ) : null}
      {page.next_cursor && more ? (
        <NotificationsPage cursor={page.next_cursor} size={size} onOpen={onOpen} />
      ) : null}
    </>
  );
}

export function NotificationsScreen({ size }: { size: number }) {
  const { t } = useLingui();
  const goTo = useGoTo();
  const markRead = useMarkNotificationsRead();
  const refresh = useInboxRefresh();
  const first = okData(useListNotifications({ limit: size }).data);
  const empty = first !== undefined && first.notifications.length === 0;
  const open = async (id: string, link: string, read: boolean) => {
    if (!read) await markRead.mutateAsync({ data: { ids: [id] } });
    await refresh();
    await goTo(link);
  };
  const markAll = async () => {
    await markRead.mutateAsync({ data: { all: true } });
    await refresh();
  };
  return (
    <main className="flex min-h-0 flex-col gap-(--density-flow-gap) overflow-auto px-8 pt-5.5 pb-4.5 pl-7">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-page-title font-semibold tracking-[-0.01em] text-fg">
            <Trans>Notifications</Trans>
          </h1>
          <p className="mt-0.75 mb-0 text-body-sm leading-[1.45] text-fg-dim">
            <Trans>Every notification, read and unread, newest first</Trans>
          </p>
        </div>
        <Button onClick={() => void markAll()} disabled={markRead.isPending}>
          <Trans>Mark all read</Trans>
        </Button>
      </header>
      <ul
        aria-label={t`All notifications`}
        className="m-0 max-w-[760px] list-none overflow-hidden rounded-lg border border-line p-0"
        data-phi=""
      >
        <NotificationsPage
          cursor={undefined}
          size={size}
          onOpen={(id, link, read) => void open(id, link, read)}
        />
        {empty ? (
          <li className="flex items-center gap-2 px-4 py-6 text-body-sm text-fg-dim">
            <Icon name="check" />
            <Trans>Nothing here yet</Trans>
          </li>
        ) : null}
      </ul>
    </main>
  );
}
