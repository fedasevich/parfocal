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
import { StatusTag } from "@parfocal/ui/components/tag";
import { Zone } from "@parfocal/ui/components/zone";
import { formatClock } from "../format.ts";
import type { AdminSection } from "../onboarding/scenes.ts";
import { toPersonInfo, usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { ModelStatus, TextLink, tb } from "./common.tsx";
import { storageParts } from "./storage.tsx";

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
        <span className="font-medium text-fg">Webhook</span>
        {sub ? <small className="truncate text-caption text-fg-faint">{sub}</small> : null}
      </span>
    </span>
  );
}

export function OverviewSection({ open }: { open: (section: AdminSection) => void }) {
  const overview = useGetAdminOverview().data?.data;
  const members = okData(useListTenantMembers().data) ?? [];
  const models = useListAiModels().data?.data;
  const storage = useGetStorageUsage().data?.data;
  const events = okData(useListAuditEvents().data) ?? [];
  const personOf = usePeople();
  if (overview === undefined) return null;
  const researchersShown = members.slice(0, 6).map(toPersonInfo);
  return (
    <>
      <StatStrip
        stats={[
          {
            value: overview.people,
            label: "People",
            detail: `${overview.invites_waiting} invites waiting`,
          },
          {
            value: overview.models,
            label: "AI models",
            detail: `${overview.runs_now} runs going now`,
          },
          {
            value: tb(overview.stored_tb),
            label: `Stored, of ${tb(overview.capacity_tb)}`,
            detail: `${tb(overview.in_place_tb)} more read in place`,
          },
          {
            value: overview.webhook_calls_today,
            label: "Webhook calls today",
            detail: `${overview.webhook_rejected_today} rejected`,
          },
        ]}
      />
      <div className="grid grid-cols-2 gap-(--space-zone)">
        <Zone
          title="People and roles"
          end={<TextLink onClick={() => open("people")}>Manage</TextLink>}
        >
          <div className="flex items-center gap-3 text-body-sm text-fg-dim">
            <AvatarStack
              people={researchersShown}
              max={6}
              size={28}
              aria-label={`${overview.people} people`}
            />
            <span>
              {overview.people} people in {overview.projects} projects
            </span>
          </div>
          <div>
            {[
              ["Researchers", overview.researchers, "Upload, run models, create tasks, sign off"],
              ["Reviewers", overview.reviewers, "Review the slides they are given"],
              [
                "With admin rights",
                overview.with_admin_rights,
                "Researchers who also set up this page",
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
          title="AI models"
          end={<TextLink onClick={() => open("models")}>All {overview.models}</TextLink>}
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
          title="Storage and sources"
          end={<TextLink onClick={() => open("storage")}>Open</TextLink>}
        >
          {storage ? (
            <StorageBar size="sm" totalTb={storage.total_tb} parts={storageParts(storage)} />
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
                {source.health === "expiring" ? (
                  <StatusTag tone="warn">Expires in {source.expires_in_days} days</StatusTag>
                ) : (
                  <StatusTag tone="ok">Answering</StatusTag>
                )}
              </SummaryRow>
            ))}
          </div>
        </Zone>
        <Zone
          title="Recent activity"
          end={<TextLink onClick={() => open("audit")}>Audit log</TextLink>}
        >
          <div>
            {events
              .filter((event) => !quietActions.has(event.action))
              .map((event) => {
                const person = personOf(event.actor_id);
                return (
                  <SummaryRow key={event.id}>
                    {person ? (
                      <Person person={person} size={28} sub={event.details} className="min-w-0" />
                    ) : (
                      <SystemActor size={28} sub={event.details} />
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
