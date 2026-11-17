import { Trans, useLingui } from "@lingui/react/macro";
import { type StorageUsage, useGetStorageUsage } from "@parfocal/api-client";
import { NameCell, SettingRow, StorageBar, type StoragePart } from "@parfocal/ui/components/admin";
import { Icon } from "@parfocal/ui/components/icon";
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
import { projectColour } from "../palette.ts";
import { okData } from "../placeholder.tsx";
import { type Notify, tableClass } from "./common.tsx";
import { RetentionZone } from "./retention.tsx";
import {
  barTotalTb,
  fullness,
  projectShare,
  sizeText,
  sourceState,
  spaceParts,
} from "./storage-model.ts";

export const storageParts = (usage: StorageUsage): StoragePart[] =>
  spaceParts(usage).map(({ label, tb, colour }) => ({ label, tb, colour }));

const sourceIcon = (kind: string) =>
  kind === "dicomweb" ? "slides" : kind === "https" ? "link" : "folder";

function SpaceNote({ usage }: { usage: StorageUsage }) {
  const state = fullness(usage);
  if (state === "nearly-full")
    return (
      <StatusTag tone="warn">
        <Trans>Nearly full</Trans>
      </StatusTag>
    );
  if (state === "full")
    return (
      <StatusTag tone="warn">
        <Trans>Full</Trans>
      </StatusTag>
    );
  return null;
}

export function StorageSection({ notify }: { notify: Notify }) {
  const { t } = useLingui();

  const usage = okData(useGetStorageUsage().data);
  const [rules, setRules] = useState<Record<string, boolean>>({});
  if (usage === undefined) return null;
  return (
    <>
      <div className="grid grid-cols-2 gap-(--space-zone)">
        <Zone title={t`Space`} end={<SpaceNote usage={usage} />}>
          <StorageBar
            totalTb={barTotalTb(usage)}
            parts={storageParts(usage)}
            foot={
              <Trans>
                Read in place, not counted:{" "}
                <span className="font-mono">{sizeText(usage.in_place_bytes)}</span> stays on your
                sources
              </Trans>
            }
          />
          <div className="mt-2 text-caption font-semibold text-fg-dim">
            <Trans>By project</Trans>
          </div>
          {usage.by_project.length === 0 ? (
            <p className="text-body-sm text-fg-dim">
              <Trans>No projects yet.</Trans>
            </p>
          ) : (
            <ul aria-label={t`Space by project`} className="m-0 grid list-none gap-2.5 p-0">
              {usage.by_project.map((row) => (
                <li
                  key={row.project.id}
                  className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 text-body-sm"
                >
                  <i
                    className="size-2.5 rounded-full"
                    style={{ background: projectColour(row.colour) }}
                  />
                  <b className="truncate font-medium text-fg">{row.project.name}</b>
                  <span className="font-mono text-fg-dim">
                    {row.cap_gb ? t`${row.gb} of ${row.cap_gb} GB` : sizeText(row.bytes)}
                  </span>
                  <span className="col-span-2 col-start-2 h-1 overflow-hidden rounded-full bg-track">
                    <i
                      className="block h-full rounded-full"
                      style={{
                        width: `${projectShare(row.bytes, usage).toFixed(1)}%`,
                        background: projectColour(row.colour),
                      }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Zone>
        <Zone title={t`Rules for sources`}>
          <div>
            {usage.rules.map((rule) => (
              <SettingRow
                key={rule.key}
                label={rule.label}
                detail={rule.detail}
                on={rules[rule.key] ?? rule.on}
                locked={rule.locked}
                onChange={(on) => setRules({ ...rules, [rule.key]: on })}
              />
            ))}
          </div>
        </Zone>
      </div>
      <RetentionZone notify={notify} />
      <Zone
        title={t`Sources`}
        end={
          <span className="text-body-sm text-fg-dim">
            <Trans>{usage.sources.length} sources</Trans>
          </span>
        }
      >
        {usage.sources.length === 0 ? (
          <p className="text-body-sm text-fg-dim">
            <Trans>
              No saved sources yet. Save one when you import slides from a link or a bucket.
            </Trans>
          </p>
        ) : (
          <Table className={tableClass}>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Trans>Source</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Address</Trans>
                </TableHead>
                <TableHead>
                  <Trans>New slides</Trans>
                </TableHead>
                <TableHead>
                  <Trans>State</Trans>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.sources.map((source) => {
                const state = sourceState(source);
                return (
                  <TableRow key={source.id}>
                    <TableCell>
                      <NameCell
                        lead={<Icon name={sourceIcon(source.kind)} />}
                        title={source.name}
                        sub={source.access}
                      />
                    </TableCell>
                    <TableCell className="font-mono">{source.address}</TableCell>
                    <TableCell>
                      {source.new_slides === "copied" ? t`Copied` : t`Read in place`}
                    </TableCell>
                    <TableCell>
                      <StatusTag tone={state.tone}>{state.text}</StatusTag>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Zone>
    </>
  );
}
