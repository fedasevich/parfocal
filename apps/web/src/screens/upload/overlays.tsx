import { type ProjectImports, type UploadBatch, useGetProjectImports } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@parfocal/ui/components/dialog";
import { Icon } from "@parfocal/ui/components/icon";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { Switch } from "@parfocal/ui/components/switch";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Hint, Zone } from "@parfocal/ui/components/zone";
import { type ReactNode, useState } from "react";
import { CheckRow, FileIcon, FileList, FileRow } from "./parts.tsx";

export function DropOverlay({
  projectCode,
  slides,
  results,
  onDrop,
}: {
  projectCode: string;
  slides: number;
  results: number;
  onDrop: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="drop-overlay"
      onClick={onDrop}
      className="absolute inset-3 z-25 grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-accent bg-[color-mix(in_srgb,var(--page)_70%,transparent)]"
    >
      <span className="grid max-w-110 justify-items-center gap-2 rounded-[14px] border border-line bg-chrome px-8.5 py-6.5 text-center shadow-pop">
        <Icon name="upload" size="lg" className="text-accent" />
        <b className="text-[18px] text-fg">Drop to upload into {projectCode}</b>
        <span className="text-body-sm text-fg-dim">
          {slides} slides and {results} result files. The upload page opens with them, so you can
          check the match before anything starts.
        </span>
      </span>
    </button>
  );
}

export function FormatsDrawer({
  batch,
  checking,
  onCheck,
  onClear,
  onClose,
  toast,
}: {
  batch: UploadBatch;
  checking: boolean;
  onCheck: () => void;
  onClear: () => void;
  onClose: () => void;
  toast: (message: ReactNode) => void;
}) {
  const formats = [
    ["Parfocal JSON", "Regions, cells, classes, scores and IDs in one file. The native format."],
    [
      "GeoJSON or a QuPath export",
      "Polygons and points. QuPath classes and measurements are kept.",
    ],
    ["CSV or TSV", "One row per cell with x, y and a class."],
    [
      "Masks or heatmaps",
      "PNG or TIFF at one pyramid level. The level is checked with an overlay.",
    ],
  ];
  return (
    <>
      <button
        type="button"
        aria-label="Close What files work?"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default border-0 bg-[rgb(0_0_0/0.25)]"
      />
      <aside
        role="dialog"
        aria-label="What files work?"
        data-testid="formats-drawer"
        className="fixed top-0 right-0 bottom-0 z-41 grid w-130 grid-rows-[auto_minmax(0,1fr)] border-l border-line bg-surf-panel shadow-pop"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-6 py-4">
          <b className="text-[18px]">What files work?</b>
          <span className="flex-1" />
          <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </Button>
        </div>
        <div className="grid content-start gap-4 overflow-auto p-6">
          <Zone title="Slides">
            <Hint>
              Whole-slide images as the scanner writes them, up to 20 GB each: Aperio SVS, Hamamatsu
              NDPI, 3DHISTECH MRXS, pyramidal TIFF and OME-TIFF, Zeiss CZI, Philips iSyntax and
              DICOM WSI.
            </Hint>
          </Zone>
          <Zone
            title={
              <>
                AI results <span className="ml-1.5 font-normal text-fg-dim">optional</span>
              </>
            }
            sub="A result file goes with the slide that has the same name, or whose ID is inside the file."
          >
            <FileList>
              {formats.map(([name, text]) => (
                <div key={name} className="grid gap-0.75 border-line px-3.5 py-2.5 [&+&]:border-t">
                  <b className="text-body-sm font-semibold">{name}</b>
                  <small className="text-body-sm leading-[1.4] text-fg-dim">{text}</small>
                </div>
              ))}
            </FileList>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Hint>Templates</Hint>
              <span className="flex-1" />
              <Button onClick={() => toast("Downloads parfocal-results.template.json (mock)")}>
                <Icon name="download" />
                Parfocal JSON
              </Button>
              <Button onClick={() => toast("Downloads cells.template.csv (mock)")}>
                <Icon name="download" />
                CSV
              </Button>
              <Button
                variant="ghost"
                onClick={() => toast("Downloads the JSON Schema, draft 2020-12 (mock)")}
              >
                JSON Schema
              </Button>
            </div>
          </Zone>
          <Zone title="Check a file">
            {checking ? (
              <>
                <FileList>
                  <FileRow
                    lead={<FileIcon />}
                    name={batch.format_check.file}
                    detail={batch.format_check.detail}
                    end={
                      <Button size="sm" variant="ghost" onClick={onClear}>
                        Clear
                      </Button>
                    }
                  />
                </FileList>
                <div className="grid gap-1.5" data-testid="format-findings">
                  {batch.format_check.findings.map((finding) => (
                    <CheckRow key={finding.text} tone={finding.tone}>
                      {finding.text}
                    </CheckRow>
                  ))}
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={onCheck}
                className="grid cursor-pointer justify-items-center gap-2 rounded-[10px] border-[1.5px] border-dashed border-line-strong bg-surf-panel p-5 text-center text-body-sm text-fg-dim hover:border-accent"
              >
                <Icon name="upload" size="md" />
                <b className="text-body font-semibold text-fg">Drop a result file</b>
                <span>See what Parfocal makes of it. Nothing is imported.</span>
              </button>
            )}
          </Zone>
        </div>
      </aside>
    </>
  );
}

type ImportsTab = "watch" | "hook" | "out" | "api";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-body-sm font-semibold text-fg">{label}</span>
      {children}
    </div>
  );
}

function ReadOnly({ value, end }: { value: string; end?: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2 rounded-ctl border border-line-strong bg-surf-field px-2.5">
      <span className="min-w-0 flex-1 truncate font-mono text-body-sm text-fg">{value}</span>
      {end}
    </div>
  );
}

const codeClass =
  "m-0 overflow-hidden rounded-[10px] border border-line bg-chrome px-4 py-3.5 font-mono text-caption leading-[1.6] whitespace-pre text-fg-dim";

function ImportsBody({
  tab,
  imports,
  projectCode,
}: {
  tab: ImportsTab;
  imports: ProjectImports;
  projectCode: string;
}) {
  const [example, setExample] = useState(false);
  const [fresh, setFresh] = useState(false);
  if (tab === "watch") {
    const folder = imports.watched_folder;
    return (
      <Zone
        title="Watched folder"
        sub={`New files in this folder arrive in ${projectCode} on their own, checked like an upload.`}
        end={<Switch defaultChecked={folder.on} aria-label="Watched folder on" />}
      >
        <Field label="Folder">
          <ReadOnly value={folder.address} end={<StatusTag tone="ok">Connected</StatusTag>} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="New slides">
            <Select defaultValue={folder.slides}>
              <SelectTrigger aria-label="New slides" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Read in place">Read in place</SelectItem>
                <SelectItem value="Copy into Parfocal">Copy into Parfocal</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Result files">
            <Select defaultValue={folder.results}>
              <SelectTrigger aria-label="Result files" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={folder.results}>{folder.results}</SelectItem>
                <SelectItem value="Same name only">Same name only</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex items-center gap-2.5 text-body-sm text-fg">
          <span>Look for new files every</span>
          <Select defaultValue={folder.every}>
            <SelectTrigger size="sm" aria-label="How often" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5 minutes">5 minutes</SelectItem>
              <SelectItem value={folder.every}>{folder.every}</SelectItem>
              <SelectItem value="1 hour">1 hour</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Zone>
    );
  }
  if (tab === "hook") {
    const hook = imports.webhook;
    return (
      <Zone
        title="Incoming webhook"
        sub="Your pipeline posts a link to a slide, its results or both. Parfocal fetches them, runs the same checks and answers with what it did."
        end={<Switch defaultChecked={hook.on} aria-label="Webhook on" />}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Webhook URL for ${projectCode}`}>
            <ReadOnly
              value={hook.url}
              end={<span className="text-body-sm text-accent">Copy</span>}
            />
          </Field>
          <Field label="Signing secret">
            <ReadOnly
              value={`whsec_••••••••${hook.secret_end}`}
              end={<span className="text-body-sm text-accent">Rotate</span>}
            />
          </Field>
        </div>
        <Field label="A call can">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {hook.abilities.map((ability) => (
              <label key={ability.label} className="flex items-center gap-2 text-body-sm text-fg">
                <Checkbox defaultChecked={ability.on} />
                {ability.label}
              </label>
            ))}
          </div>
        </Field>
        {example ? (
          <pre className={codeClass}>
            {`POST /hooks/${projectCode}/in/whk_8f3a…
{ "event": "slide.add",
  "slide": { "url": "s3://fnvltava-scans/tumor_090.tif", "read": "in-place" },
  "results": [{ "url": "s3://…/tumor_090.geojson", "model": "lab-model", "version": "3.0" }] }`}
          </pre>
        ) : null}
        <button
          type="button"
          onClick={() => setExample(!example)}
          className="cursor-pointer justify-self-start border-0 bg-transparent p-0 text-body-sm font-medium text-accent hover:underline"
        >
          {example ? "Hide the example call" : "Show an example call"}
        </button>
      </Zone>
    );
  }
  if (tab === "out") {
    const out = imports.events_out;
    return (
      <Zone
        title="Events out"
        sub="Parfocal calls your URL when something happens, so a pipeline can react."
        end={<Switch defaultChecked={out.on} aria-label="Events out on" />}
      >
        <Field label="Your endpoint">
          <ReadOnly
            value={out.endpoint}
            end={<StatusTag tone="ok">Last call {out.last_call}</StatusTag>}
          />
        </Field>
        <FileList>
          {out.events.map((event) => (
            <div
              key={event.name}
              className="grid min-h-10.5 grid-cols-[28px_170px_minmax(0,1fr)] items-center gap-3 border-line px-3.5 text-body-sm text-fg-dim [&+&]:border-t"
            >
              <Switch size="sm" defaultChecked={event.on} aria-label={event.name} />
              <b className="font-mono font-medium text-fg">{event.name}</b>
              <span>{event.text}</span>
            </div>
          ))}
        </FileList>
      </Zone>
    );
  }
  return (
    <Zone
      title="API token"
      sub={`For scripts. Add slides and result sets to ${projectCode} with one call.`}
      end={
        fresh ? undefined : (
          <Button size="sm" onClick={() => setFresh(true)}>
            New token
          </Button>
        )
      }
    >
      <Field label={`Token for ${projectCode}`}>
        <ReadOnly
          value={
            fresh
              ? `pf_live_${projectCode}_7c21d9e04b3a`
              : `pf_live_${projectCode}_••••••••${imports.token.end}`
          }
          end={<span className="text-body-sm text-accent">Copy</span>}
        />
      </Field>
      {fresh ? (
        <Hint>
          Shown once, so copy it now. The old token ending {imports.token.end} stops working in 24
          hours.
        </Hint>
      ) : null}
      <pre className={codeClass}>
        {`curl -X POST $PARFOCAL/api/v1/projects/${projectCode}/result-sets \\
  -H "Authorization: Bearer $PF_TOKEN" \\
  -F "slide_url=s3://fnvltava-scans/tumor_090.tif" -F "model=lab-model" \\
  -F "version=3.0" -F "file=@tumor_090.geojson"`}
      </pre>
    </Zone>
  );
}

const codeTone = (code: number) => (code < 300 ? "ok" : code === 401 ? "bad" : "warn");

export function ImportsModal({
  projectId,
  projectCode,
  onClose,
}: {
  projectId: string;
  projectCode: string;
  onClose: () => void;
}) {
  const imports = useGetProjectImports(projectId).data?.data;
  const [tab, setTab] = useState<ImportsTab>("watch");
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        showCloseButton={false}
        className="grid max-h-[calc(100%-56px)] w-205 max-w-[calc(100%-56px)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 sm:max-w-[calc(100%-56px)]"
        data-testid="imports-modal"
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <DialogTitle className="text-title-sm font-semibold">Automatic imports</DialogTitle>
            <small className="text-body-sm text-fg-dim">
              Slides and results that arrive in {projectCode} without anyone uploading them
            </small>
          </div>
          <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </Button>
        </div>
        <div className="grid content-start gap-4 overflow-auto p-5">
          <div className="flex">
            <SegmentedControl
              aria-label="Kind of import"
              value={tab}
              onValueChange={(value) => setTab(value as ImportsTab)}
              options={[
                { value: "watch", label: "Watched folder" },
                { value: "hook", label: "Webhook in" },
                { value: "out", label: "Events out" },
                { value: "api", label: "API token" },
              ]}
            />
          </div>
          {imports ? <ImportsBody tab={tab} imports={imports} projectCode={projectCode} /> : null}
          {imports && tab !== "out" ? (
            <Zone title="Last arrivals" end={<Hint>Problems also show in notifications</Hint>}>
              <table className="w-full border-collapse text-body-sm">
                <tbody>
                  {imports.arrivals.map((arrival) => (
                    <tr
                      key={arrival.at}
                      className="[&>td]:border-b [&>td]:border-line [&>td]:p-2 [&>td]:whitespace-nowrap [&>td]:text-fg-dim last:[&>td]:border-b-0"
                    >
                      <td className="font-mono">{arrival.at}</td>
                      <td className="font-mono">{arrival.event}</td>
                      <td>
                        <b className="font-mono font-medium text-fg">{arrival.file}</b>
                      </td>
                      <td>
                        <StatusTag tone={codeTone(arrival.code)}>{arrival.code}</StatusTag>
                      </td>
                      <td>{arrival.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Zone>
          ) : null}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-5 py-3.5">
          <Hint>Every arrival goes through the same checks as an upload.</Hint>
          <span className="flex-1" />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
