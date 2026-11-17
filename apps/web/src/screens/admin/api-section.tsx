import { Trans, useLingui } from "@lingui/react/macro";
import {
  getListServiceAccountsQueryKey,
  type IssuedToken,
  type ServiceScope,
  useCreateServiceAccount,
  useListServiceAccounts,
  useListWebhooks,
  useRevokeApiToken,
  type Webhook,
} from "@parfocal/api-client";
import { NameCell } from "@parfocal/ui/components/admin";
import { Button } from "@parfocal/ui/components/button";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { FormField, TextFieldInput } from "@parfocal/ui/components/form-field";
import { Icon } from "@parfocal/ui/components/icon";
import { SmallModal, SmallModalZone } from "@parfocal/ui/components/small-modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Zone } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { now } from "../../clock.ts";
import { formatDue } from "../format.ts";
import { okData } from "../placeholder.tsx";
import { InfoLine, lastActive, type Notify, tableClass } from "./common.tsx";
import { failure } from "./shared-settings.tsx";
import { liveTokens, SCOPES, scopeNames, TOKEN_DAYS, tokenDraftError } from "./tokens-model.ts";

const right = "text-right";

function NewTokenModal({ onClose, notify }: { onClose: () => void; notify: Notify }) {
  const { t } = useLingui();

  const queryClient = useQueryClient();
  const create = useCreateServiceAccount();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ServiceScope[]>(["see-slides", "upload-slides"]);
  const [tried, setTried] = useState(false);
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const error = tokenDraftError(name, scopes);

  if (issued !== null)
    return (
      <SmallModal
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        width={480}
        title={t`Copy the token now`}
        subtitle={t`It is shown once. Parfocal keeps only a fingerprint of it.`}
        showCancel={false}
        primaryLabel={t`Done`}
        onPrimary={onClose}
      >
        <SmallModalZone title={t`Token`}>
          <div className="flex items-center gap-2">
            <code
              data-testid="issued-token"
              className="min-w-0 flex-1 truncate rounded-md bg-chrome-3 px-2.5 py-2 font-mono text-body-sm text-fg"
            >
              {issued.token}
            </code>
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard
                  .writeText(issued.token)
                  .then(() => notify(t`Token copied`))
                  .catch(() => notify(t`Copy the token by hand`));
              }}
            >
              <Trans>Copy</Trans>
            </Button>
          </div>
          <p className="text-body-sm text-fg-dim">
            <Trans>Valid until {formatDue(issued.expires_at.slice(0, 10))}.</Trans>
          </p>
        </SmallModalZone>
      </SmallModal>
    );

  return (
    <SmallModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      width={480}
      title={t`New token`}
      subtitle={t`For a pipeline that sends slides or results into Parfocal`}
      cancelLabel={t`Cancel`}
      onCancel={onClose}
      primaryLabel={t`Create token`}
      primaryBusy={create.isPending}
      blockers={tried && error ? [{ id: "token", text: error, goTo: t`Go to the name` }] : []}
      blockersTitle={t`Before you can create it`}
      hint={t`Valid for ${TOKEN_DAYS} days. Revoke it here at any time.`}
      onPrimary={() => {
        setTried(true);
        if (error) return;
        create.mutate(
          { data: { name: name.trim(), scopes, expires_in_days: TOKEN_DAYS } },
          {
            onSuccess: (response) => {
              if (response.status !== 201) {
                notify(response.data.title);
                return;
              }
              void queryClient.invalidateQueries({ queryKey: getListServiceAccountsQueryKey() });
              setIssued(response.data.token);
            },
            onError: (problem) => notify(failure(problem)),
          },
        );
      }}
    >
      <FormField label={t`Name`} error={tried && name.trim() === "" ? error : undefined}>
        <TextFieldInput
          placeholder={t`Add result sets to P07`}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <SmallModalZone title={t`It can`}>
        <div className="grid">
          {SCOPES.map((scope) => (
            <label
              key={scope.key}
              className="flex min-h-10 cursor-pointer items-center gap-2.5 border-t border-line text-body-sm first:border-t-0"
            >
              <Checkbox
                checked={scopes.includes(scope.key)}
                onCheckedChange={(on) =>
                  setScopes(
                    on ? [...scopes, scope.key] : scopes.filter((chosen) => chosen !== scope.key),
                  )
                }
              />
              <span className="text-fg">{scope.label}</span>
            </label>
          ))}
        </div>
      </SmallModalZone>
    </SmallModal>
  );
}

function TokensZone({ notify }: { notify: Notify }) {
  const { t } = useLingui();

  const queryClient = useQueryClient();
  const accounts = okData(useListServiceAccounts().data) ?? [];
  const revoke = useRevokeApiToken();
  const [creating, setCreating] = useState(false);
  const rows = liveTokens(accounts, now());
  return (
    <Zone
      title={t`Tokens`}
      end={
        <Button size="sm" onClick={() => setCreating(true)}>
          <Trans>New token</Trans>
        </Button>
      }
    >
      {creating ? <NewTokenModal notify={notify} onClose={() => setCreating(false)} /> : null}
      {rows.length === 0 ? (
        <p className="text-body-sm text-fg-dim">
          <Trans>No tokens yet. A pipeline needs one to send slides or results.</Trans>
        </p>
      ) : (
        <Table className={tableClass}>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans>Token</Trans>
              </TableHead>
              <TableHead>
                <Trans>Valid until</Trans>
              </TableHead>
              <TableHead>
                <Trans>Last used</Trans>
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ account, token }) => (
              <TableRow key={token.id}>
                <TableCell>
                  <NameCell
                    lead={<Icon name="key" />}
                    title={account.name}
                    sub={scopeNames(account.scopes)}
                  />
                </TableCell>
                <TableCell>{formatDue(token.expires_at.slice(0, 10))}</TableCell>
                <TableCell>
                  {token.last_used_at ? lastActive(token.last_used_at) : t`Never`}
                </TableCell>
                <TableCell>
                  <span className="flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t`Revoke the token for ${account.name}`}
                      disabled={revoke.isPending}
                      onClick={() =>
                        revoke.mutate(
                          { accountId: account.id, tokenId: token.id },
                          {
                            onSuccess: () => {
                              void queryClient.invalidateQueries({
                                queryKey: getListServiceAccountsQueryKey(),
                              });
                              notify(t`Token revoked. Pipelines using it stop at once.`);
                            },
                            onError: (problem) => notify(failure(problem)),
                          },
                        )
                      }
                    >
                      <Trans>Revoke</Trans>
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Zone>
  );
}

function HookState({ hook }: { hook: Webhook }) {
  if (hook.paused)
    return (
      <StatusTag tone="warn">
        <Trans>Paused</Trans>
      </StatusTag>
    );
  if (hook.rejected_today > 0)
    return (
      <StatusTag tone="warn">
        {hook.direction === "incoming" ? (
          <Trans>{hook.rejected_today} rejected</Trans>
        ) : (
          <Trans>{hook.rejected_today} failed</Trans>
        )}
      </StatusTag>
    );
  return (
    <StatusTag tone="ok">
      <Trans>Working</Trans>
    </StatusTag>
  );
}

function WebhooksZone({ direction }: { direction: Webhook["direction"] }) {
  const { t } = useLingui();

  const hooks = (okData(useListWebhooks().data) ?? []).filter(
    (hook) => hook.direction === direction,
  );
  const incoming = direction === "incoming";
  return (
    <Zone title={incoming ? t`Webhooks in` : t`Event targets out`}>
      {hooks.length === 0 ? (
        <p className="text-body-sm text-fg-dim">
          {incoming ? (
            <Trans>No project has an incoming webhook yet.</Trans>
          ) : (
            <Trans>No project sends events to a pipeline yet.</Trans>
          )}
        </p>
      ) : (
        <Table className={tableClass}>
          <TableHeader>
            <TableRow>
              <TableHead>{incoming ? <Trans>Webhook</Trans> : <Trans>Target</Trans>}</TableHead>
              <TableHead>
                <Trans>Project</Trans>
              </TableHead>
              <TableHead>
                <Trans>Events</Trans>
              </TableHead>
              <TableHead className={right}>
                <Trans>Today</Trans>
              </TableHead>
              <TableHead>
                <Trans>State</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hooks.map((hook) => (
              <TableRow key={hook.id}>
                <TableCell>
                  <NameCell
                    lead={<Icon name={incoming ? "upload" : "link"} />}
                    title={hook.name}
                    sub={hook.address ?? undefined}
                  />
                </TableCell>
                <TableCell>{hook.project?.name ?? ""}</TableCell>
                <TableCell className="font-mono">{hook.events.join(", ")}</TableCell>
                <TableCell className={cn(right, "font-mono")}>{hook.calls_today}</TableCell>
                <TableCell>
                  <HookState hook={hook} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Zone>
  );
}

export function ApiSection({ notify }: { notify: Notify }) {
  return (
    <>
      <TokensZone notify={notify} />
      <WebhooksZone direction="incoming" />
      <WebhooksZone direction="outgoing" />
      <InfoLine>
        <Trans>
          Pipelines post slides and result files to a project's incoming webhook, signed with its
          secret. Event targets receive signed calls when reviews and result sets change.
        </Trans>
      </InfoLine>
    </>
  );
}
