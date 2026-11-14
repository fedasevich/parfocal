import { Trans, useLingui } from "@lingui/react/macro";
import {
  getListTenantMembersQueryKey,
  getListWorkspaceAccessRequestsQueryKey,
  type PendingAccessRequest,
  useApproveWorkspaceAccessRequest,
  useDeclineWorkspaceAccessRequest,
  useListWorkspaceAccessRequests,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Person } from "@parfocal/ui/components/person";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { Zone } from "@parfocal/ui/components/zone";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toPersonInfo } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { lastActive, type Notify, tableClass } from "./common.tsx";

const askedText = (ask: PendingAccessRequest) =>
  `${ask.email ?? ""} · asked ${lastActive(ask.asked_at).toLowerCase()}`;

export function JoinRequestsZone({
  notify,
  opened,
}: {
  notify: Notify;
  opened?: string | undefined;
}) {
  const { t } = useLingui();

  const asks = okData(useListWorkspaceAccessRequests().data);
  const queryClient = useQueryClient();
  const approve = useApproveWorkspaceAccessRequest();
  const decline = useDeclineWorkspaceAccessRequest();
  const openedRow = useRef<HTMLTableRowElement>(null);
  const shown = asks !== undefined;
  useEffect(() => {
    if (shown) openedRow.current?.scrollIntoView({ block: "center" });
  }, [shown]);
  if (asks === undefined || (asks.length === 0 && opened === undefined)) return null;
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getListWorkspaceAccessRequestsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListTenantMembersQueryKey() }),
    ]);
  const answered = (said: string) => ({
    onSuccess: () => {
      void refresh();
      notify(said);
    },
    onError: () => {
      void refresh();
      notify("This ask is already answered.");
    },
  });
  const approveAsk = (ask: PendingAccessRequest) =>
    approve.mutate({ requestId: ask.id }, answered(`${ask.display_name} joined as a reviewer.`));
  const declineAsk = (ask: PendingAccessRequest) =>
    decline.mutate(
      { requestId: ask.id },
      answered(`You declined ${ask.display_name}'s ask to join.`),
    );
  return (
    <Zone
      title={t`Join requests`}
      sub="People from your email domain who asked to join. They join as reviewers, and you can raise their role later."
      end={
        <span className="text-body-sm text-fg-dim">
          <Trans>{asks.length} waiting</Trans>
        </span>
      }
    >
      {asks.length === 0 ? (
        <p className="m-0 text-body-sm text-fg-dim">
          <Trans>This ask is already answered. No one else is waiting.</Trans>
        </p>
      ) : (
        <Table className={tableClass} aria-label={t`Join requests`}>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans>Person</Trans>
              </TableHead>
              <TableHead>
                <Trans>Title</Trans>
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {asks.map((ask) => {
              const isOpened = ask.id === opened;
              return (
                <TableRow
                  key={ask.id}
                  ref={isOpened ? openedRow : undefined}
                  aria-current={isOpened ? "true" : undefined}
                  className={isOpened ? "bg-accent-soft" : undefined}
                >
                  <TableCell>
                    <Person person={toPersonInfo(ask)} size={28} sub={askedText(ask)} />
                  </TableCell>
                  <TableCell>
                    {ask.title ?? (
                      <span className="text-fg-faint">
                        <Trans>None</Trans>
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t`Decline ${ask.display_name}`}
                        onClick={() => declineAsk(ask)}
                      >
                        <Trans>Decline</Trans>
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        aria-label={t`Approve ${ask.display_name}`}
                        onClick={() => approveAsk(ask)}
                      >
                        <Trans>Approve</Trans>
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Zone>
  );
}
