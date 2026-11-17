import { Trans, useLingui } from "@lingui/react/macro";
import {
  useGetAdminOverview,
  useGetStorageUsage,
  useListAiModels,
  useListAuditEvents,
  useListTenantMembers,
} from "@parfocal/api-client";
import { NameCell, StatStrip, StorageBar, SummaryRow } from "@parfocal/ui/components/admin";
import { Icon } from "@parfocal/ui/components/icon";
import { AvatarStack, Person } from "@parfocal/ui/components/person";
import { SkeletonCards } from "@parfocal/ui/components/skeleton";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Zone } from "@parfocal/ui/components/zone";
import { now } from "../../clock.ts";
import { formatClock } from "../format.ts";
import type { AdminSection } from "../onboarding/scenes.ts";
import { toPersonInfo, usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { auditLabel, auditParams, defaultAuditFilter } from "./audit-model.ts";
import { ModelStatus, TextLink, tb } from "./common.tsx";
import { storageParts } from "./storage.tsx";
import { barTotalTb, sourceState } from "./storage-model.ts";

const quietActions = new Set(["slide.opened", "decision.changed-after-sign-off"]);

export function SystemActor({ sub, size = 20 }: { sub?: string; size?: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span
        className="grid flex-none place-items-center rounded-full bg-chrome-3 text-fg-dim"
        style={{ width: size, height: size }}
      >
        <Icon name="link" size="xs" />
      </span>
      <span className="grid min-w-0 leading-tight">
        <span className="font-medium text-fg">
          <Trans>Webhook</Trans>
        </span>
        {sub ? <small className="truncate text-caption text-fg-faint">{sub}</small> : null}
      </span>
    </span>
  );
}

export function OverviewSection({ open }: { open: (section: AdminSection) => void }) {
  const { t } = useLingui();

  const overview = okData(useGetAdminOverview().data);
  const members = okData(useListTenantMembers().data) ?? [];
  const models = okData(useListAiModels().data);
  const storage = okData(useGetStorageUsage().data);
  const events = okData(useListAuditEvents(auditParams(defaultAuditFilter, now())).data) ?? [];
  const personOf = usePeople();
  if (overview === undefined) {
    return <SkeletonCards label={t`Loading the overview`} cards={6} />;
  }
  const researchersShown = members.slice(0, 6).map(toPersonInfo);
  return (
    <>
      <StatStrip
        stats={[
          {
            value: overview.people,
            label: t`People`,
            detail: t`${overview.invites_waiting} invites waiting`,
          },
          {
            value: overview.models,
            label: "AI models",
            detail: t`${overview.runs_now} runs going now`,
          },
          {
            value: tb(overview.stored_tb),
            label:
              overview.capacity_tb === null ? t`Stored` : t`Stored, of ${tb(overview.capacity_tb)}`,
            detail: t`${tb(overview.in_place_tb)} more read in place`,
          },
          {
            value: overview.webhook_calls_today,
            label: t`Webhook calls today`,
            detail: `${overview.webhook_rejected_today} rejected`,
          },
        ]}
      />
      <div className="grid grid-cols-2 gap-(--space-zone)">
        <Zone
          title={t`People and roles`}
          end={
            <TextLink onClick={() => open("people")}>
              <Trans>Manage</Trans>
            </TextLink>
          }
        >
          <div className="flex items-center gap-3 text-body-sm text-fg-dim">
            <AvatarStack
              people={researchersShown}
              max={6}
              size={28}
              aria-label={t`${overview.people} people`}
            />
            <span>
              <Trans>
                {overview.people} people in {overview.projects} projects
              </Trans>
            </span>
          </div>
          <div>
            {[
              [t`Researchers`, overview.researchers, t`Upload, run models, create tasks, sign off`],
              [t`Reviewers`, overview.reviewers, t`Review the slides they are given`],
              [
                t`With admin rights`,
                overview.with_admin_rights,
                t`Researchers who also set up this page`,
              ],
            ].map(([label, count, detail]) => (
              <SummaryRow key={String(label)}>
                <span>
                  <b className="font-medium text-fg">{label}</b>
                  <small className="block text-body-sm text-fg-dim">{detail}</small>
                </span>
                <b className="font-mono text-fg">{count}</b>
              </SummaryRow>
            ))}
          </div>
        </Zone>
        <Zone
          title={t`AI models`}
          end={
            <TextLink onClick={() => open("models")}>
              <Trans>All {overview.models}</Trans>
            </TextLink>
          }
        >
          <div>
            {[
              ...(models?.models ?? []).filter((model) => model.source === "parfocal").slice(0, 2),
              ...(models?.models ?? []).filter((model) => model.status === "answering"),
            ].map((model) => (
              <SummaryRow key={model.id}>
                <NameCell
                  lead={<Icon name="smart" />}
                  title={model.name}
                  version={model.version}
                  sub={model.runs_on}
                />
                <ModelStatus model={model} />
              </SummaryRow>
            ))}
          </div>
        </Zone>
        <Zone
          title={t`Storage and sources`}
          end={
            <TextLink onClick={() => open("storage")}>
              <Trans>Open</Trans>
            </TextLink>
          }
        >
          {storage ? (
            <StorageBar size="sm" totalTb={barTotalTb(storage)} parts={storageParts(storage)} />
          ) : null}
          <div>
            {(storage?.sources ?? []).map((source) => (
              <SummaryRow key={source.id}>
                <NameCell
                  lead={
                    <Icon
                      name={
                        source.kind === "dicomweb"
                          ? "slides"
                          : source.kind === "https"
                            ? "link"
                            : "folder"
                      }
                    />
                  }
                  title={source.name}
                  sub={source.access}
                />
                <StatusTag tone={sourceState(source).tone}>{sourceState(source).text}</StatusTag>
              </SummaryRow>
            ))}
          </div>
        </Zone>
        <Zone
          title={t`Recent activity`}
          end={
            <TextLink onClick={() => open("audit")}>
              <Trans>Audit log</Trans>
            </TextLink>
          }
        >
          <div>
            {events
              .filter((event) => !quietActions.has(event.action))
              .map((event) => {
                const person = personOf(event.actor_user_id);
                return (
                  <SummaryRow key={event.id}>
                    {person ? (
                      <Person
                        person={person}
                        size={28}
                        sub={auditLabel(event.action)}
                        className="min-w-0"
                      />
                    ) : event.actor_name ? (
                      <span className="grid min-w-0 leading-tight">
                        <span className="font-medium text-fg">{event.actor_name}</span>
                        <small className="truncate text-caption text-fg-faint">
                          {auditLabel(event.action)}
                        </small>
                      </span>
                    ) : (
                      <SystemActor size={28} sub={auditLabel(event.action)} />
                    )}
                    <span className="font-mono text-caption text-fg-faint">
                      {formatClock(new Date(event.occurred_at))}
                    </span>
                  </SummaryRow>
                );
              })}
          </div>
        </Zone>
      </div>
    </>
  );
}
