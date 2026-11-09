import { type StorageUsage, useGetStorageUsage } from "@parfocal/api-client";
import { NameCell, SettingRow, StorageBar, type StoragePart } from "@parfocal/ui/components/admin";
import { Button } from "@parfocal/ui/components/button";
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
import { MoreButton, type Notify, tableClass, tb } from "./common.tsx";
import { RetentionZone } from "./retention.tsx";

const partColours = ["var(--st-1)", "var(--st-2)", "var(--st-3)"];

export const storageParts = (usage: StorageUsage): StoragePart[] =>
  usage.parts.map((part, index) => ({
    label: part.label,
    tb: part.tb,
    colour: partColours[index % partColours.length] ?? "var(--st-1)",
  }));

const sourceIcon = (kind: string) =>
  kind === "dicomweb" ? "slides" : kind === "https" ? "link" : "folder";

export function StorageSection({ notify }: { notify: Notify }) {
  const usage = useGetStorageUsage().data?.data;
  const [rules, setRules] = useState<Record<string, boolean>>({});
  if (usage === undefined) return null;
  const used = usage.parts.reduce((sum, part) => sum + part.tb, 0) * 1000;
  return (
    <>
      <div className="grid grid-cols-2 gap-(--space-zone)">
        <Zone title="Space">
          <StorageBar
            totalTb={usage.total_tb}
            parts={storageParts(usage)}
            foot={
              <>
                Read in place, not counted:{" "}
                <span className="font-mono">{tb(usage.in_place_tb)}</span> stays on your sources
              </>
            }
          />
          <div className="mt-2 text-caption font-semibold text-fg-dim">By project</div>
          <div className="grid gap-2.5">
            {usage.by_project.map((row) => (
              <div
                key={row.project.id}
                className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 text-body-sm"
              >
                <i
                  className="size-2.5 rounded-full"
                  style={{ background: projectColour(row.colour) }}
                />
                <b className="truncate font-medium text-fg">{row.project.name}</b>
                <span className="font-mono text-fg-dim">
                  {row.cap_gb ? `${row.gb} of ${row.cap_gb} GB` : `${row.gb} GB`}
                </span>
                <span className="col-span-2 col-start-2 h-1 overflow-hidden rounded-full bg-track">
                  <i
                    className="block h-full rounded-full"
                    style={{
                      width: `${((100 * row.gb) / used).toFixed(1)}%`,
                      background: projectColour(row.colour),
                    }}
                  />
                </span>
              </div>
            ))}
          </div>
        </Zone>
        <Zone title="Rules for sources">
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
        title="Sources"
        end={<span className="text-body-sm text-fg-dim">{usage.sources.length} sources</span>}
      >
        <Table className={tableClass}>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>New slides</TableHead>
              <TableHead>Health</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.sources.map((source) => (
              <TableRow key={source.id}>
                <TableCell>
                  <NameCell
                    lead={<Icon name={sourceIcon(source.kind)} />}
                    title={source.name}
                    sub={source.access}
                  />
                </TableCell>
                <TableCell className="font-mono">{source.address}</TableCell>
                <TableCell>{source.new_slides === "copied" ? "Copied" : "Read in place"}</TableCell>
                <TableCell>
                  {source.health === "expiring" ? (
                    <StatusTag tone="warn">Expires in {source.expires_in_days} days</StatusTag>
                  ) : (
                    <StatusTag tone="ok">Answering · {source.first_tile_ms} ms</StatusTag>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex items-center justify-end gap-1.5">
                    <Button
                      size="sm"
                      onClick={() =>
                        notify(
                          `Read one tile and listed the folder: answered in ${source.first_tile_ms ?? 180} ms (mock)`,
                        )
                      }
                    >
                      Test
                    </Button>
                    <MoreButton label={`More for ${source.name}`} />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Zone>
    </>
  );
}
