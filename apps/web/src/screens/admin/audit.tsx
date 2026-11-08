import {
  type AuditEvent,
  exportAuditEvents,
  useListAuditEvents,
  useListProjects,
  useListTenantMembers,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { FilterChip } from "@parfocal/ui/components/filter-chip";
import { Icon } from "@parfocal/ui/components/icon";
import { Person } from "@parfocal/ui/components/person";
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
import { useState } from "react";
import { now } from "../../clock.ts";
import { daysBetween, formatClock, formatDayMonth, plural } from "../format.ts";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import {
  type AuditFilter,
  type AuditPeriod,
  auditFileName,
  auditGroups,
  auditLabel,
  auditParams,
  auditPeriods,
  periodTitle,
} from "./audit-model.ts";
import { type Notify, tableClass } from "./common.tsx";
import { SystemActor } from "./overview.tsx";

const auditFlags: Record<string, { text: string; tone: "warn" | "bad" }> = {
  "decision.changed-after-sign-off": { text: "After sign-off", tone: "warn" },
  "project.emergency-access": { text: "Emergency", tone: "bad" },
  "webhook.rejected": { text: "Rejected", tone: "bad" },
};

type FilterProps = { filter: AuditFilter; onFilter: (next: AuditFilter) => void };

function whenText(at: Date, today: Date): string {
  const clock = formatClock(at);
  return daysBetween(at, today) === 0 ? clock : `${formatDayMonth(at)} ${clock}`;
}

function Actor({ event }: { event: AuditEvent }) {
  const personOf = usePeople();
  const person = personOf(event.actor_id);
  if (person) return <Person person={person} size={20} />;
  if (event.actor_kind === "member" || event.actor_kind === "user") {
    return <span className="text-fg-dim">A member</span>;
  }
  return <SystemActor />;
}

export function AuditSection({ filter, onFilter }: FilterProps) {
  const today = now();
  const events = okData(useListAuditEvents(auditParams(filter, today)).data) ?? [];
  const members = okData(useListTenantMembers().data) ?? [];
  const projects = okData(useListProjects().data) ?? [];
  const codeOf = new Map(projects.map((project) => [project.id, project.code]));
  return (
    <Zone
      title={periodTitle(filter.period)}
      end={<span className="text-body-sm text-fg-dim">{plural(events.length, "event")}</span>}
    >
      <div className="flex flex-wrap gap-2.5">
        <FilterChip
          label="Person"
          anyLabel="Everyone"
          options={members.map((member) => ({ value: member.user_id, label: member.display_name }))}
          value={filter.person}
          onValueChange={(person) => onFilter({ ...filter, person })}
        />
        <FilterChip
          label="Project"
          anyLabel="All projects"
          options={projects.map((project) => ({
            value: project.id,
            label: project.name,
            hint: project.code,
          }))}
          value={filter.project}
          onValueChange={(project) => onFilter({ ...filter, project })}
        />
        <FilterChip
          label="Time"
          anyLabel="Any time"
          options={auditPeriods.map(({ value, label }) => ({ value, label }))}
          value={filter.period}
          onValueChange={(period) =>
            onFilter({ ...filter, period: period as AuditPeriod | undefined })
          }
        />
        <FilterChip
          label="Action"
          anyLabel="All actions"
          options={auditGroups}
          value={filter.group}
          onValueChange={(group) => onFilter({ ...filter, group })}
        />
      </div>
      <Table className={tableClass}>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Who</TableHead>
            <TableHead>What</TableHead>
            <TableHead>Project</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => {
            const flag = auditFlags[event.action];
            const project =
              event.target_type === "project" && event.target_id
                ? codeOf.get(event.target_id)
                : undefined;
            return (
              <TableRow key={event.id}>
                <TableCell className="font-mono">
                  {whenText(new Date(event.occurred_at), today)}
                </TableCell>
                <TableCell>
                  <Actor event={event} />
                </TableCell>
                <TableCell>{auditLabel(event.action)}</TableCell>
                <TableCell className="font-mono">{project ?? ""}</TableCell>
                <TableCell>
                  {flag ? <StatusTag tone={flag.tone}>{flag.text}</StatusTag> : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {events.length === 0 ? (
        <p className="m-0 text-body-sm text-fg-dim">No events match these filters.</p>
      ) : null}
    </Zone>
  );
}

function downloadJson(document: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function AuditExportButton({ filter, notify }: { filter: AuditFilter; notify: Notify }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const today = now();
      const answer = await exportAuditEvents(auditParams(filter, today));
      if (answer.status !== 200) {
        notify("The audit log could not be exported. Try again.");
        return;
      }
      downloadJson(answer.data, auditFileName(today));
      notify(
        `Exported ${plural(answer.data.events.length, "event")}, signed with ${answer.data.signature.key_id}.`,
      );
    } catch {
      notify("The audit log could not be exported. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button disabled={busy} onClick={() => void run()}>
      <Icon name="download" />
      Export signed log
    </Button>
  );
}
