import { Trans, useLingui } from "@lingui/react/macro";
import { type ProjectImports, useGetProjectImports } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@parfocal/ui/components/dialog";
import { Icon } from "@parfocal/ui/components/icon";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { Switch } from "@parfocal/ui/components/switch";
import { StatusTag } from "@parfocal/ui/components/tag";
import { Hint, Zone } from "@parfocal/ui/components/zone";
import { scrollRegionProps } from "@parfocal/ui/lib/scroll-region";
import { useState } from "react";
import { okData } from "../placeholder.tsx";
import { Field, FileList, ReadOnly } from "./parts.tsx";
import { WatchedFolder } from "./watched-folder.tsx";

type ImportsTab = "watch" | "hook" | "out" | "api";

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
  const { t } = useLingui();

  const [example, setExample] = useState(false);
  const [fresh, setFresh] = useState(false);
  if (tab === "watch") {
    return (
      <WatchedFolder
        projectId={imports.project_id}
        projectCode={projectCode}
        folder={imports.watched_folder}
      />
    );
  }
  if (tab === "hook") {
    const hook = imports.webhook;
    return (
      <Zone
        title={t`Incoming webhook`}
        sub={t`Your pipeline posts a link to a slide, its results or both. Parfocal fetches them, runs the same checks and answers with what it did.`}
        end={<Switch defaultChecked={hook.on} aria-label={t`Webhook on`} />}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t`Webhook URL for ${projectCode}`}>
            <ReadOnly
              value={hook.url}
              end={
                <span className="text-body-sm text-accent">
                  <Trans>Copy</Trans>
                </span>
              }
            />
          </Field>
          <Field label={t`Signing secret`}>
            <ReadOnly
              value={`whsec_••••••••${hook.secret_end}`}
              end={
                <span className="text-body-sm text-accent">
                  <Trans>Rotate</Trans>
                </span>
              }
            />
          </Field>
        </div>
        <Field label={t`A call can`}>
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
            {t`POST /hooks/${projectCode}/in/whk_8f3a…
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
          {example ? t`Hide the example call` : t`Show an example call`}
        </button>
      </Zone>
    );
  }
  if (tab === "out") {
    const out = imports.events_out;
    return (
      <Zone
        title={t`Events out`}
        sub={t`Parfocal calls your URL when something happens, so a pipeline can react.`}
        end={<Switch defaultChecked={out.on} aria-label={t`Events out on`} />}
      >
        <Field label={t`Your endpoint`}>
          <ReadOnly
            value={out.endpoint}
            end={
              <StatusTag tone="ok">
                <Trans>Last call {out.last_call}</Trans>
              </StatusTag>
            }
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
      title={t`API token`}
      sub={t`For scripts. Add slides and result sets to ${projectCode} with one call.`}
      end={
        fresh ? undefined : (
          <Button size="sm" onClick={() => setFresh(true)}>
            <Trans>New token</Trans>
          </Button>
        )
      }
    >
      <Field label={t`Token for ${projectCode}`}>
        <ReadOnly
          value={
            fresh
              ? `pf_live_${projectCode}_7c21d9e04b3a`
              : `pf_live_${projectCode}_••••••••${imports.token.end}`
          }
          end={
            <span className="text-body-sm text-accent">
              <Trans>Copy</Trans>
            </span>
          }
        />
      </Field>
      {fresh ? (
        <Hint>
          <Trans>
            Shown once, so copy it now. The old token ending {imports.token.end} stops working in 24
            hours.
          </Trans>
        </Hint>
      ) : null}
      <pre className={codeClass}>
        {t`curl -X POST $PARFOCAL/api/v1/projects/${projectCode}/result-sets \\
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
  const { t } = useLingui();

  const imports = okData(useGetProjectImports(projectId).data);
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
            <DialogTitle className="text-title-sm font-semibold">
              <Trans>Automatic imports</Trans>
            </DialogTitle>
            <small className="text-body-sm text-fg-dim">
              <Trans>
                Slides and results that arrive in {projectCode} without anyone uploading them
              </Trans>
            </small>
          </div>
          <Button size="icon" variant="ghost" aria-label={t`Close`} onClick={onClose}>
            <Icon name="close" />
          </Button>
        </div>
        <div
          {...scrollRegionProps(t`Automatic imports settings`)}
          className="grid content-start gap-4 overflow-auto p-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent focus-visible:outline-solid"
        >
          <div className="flex">
            <SegmentedControl
              aria-label={t`Kind of import`}
              value={tab}
              onValueChange={(value) => setTab(value as ImportsTab)}
              options={[
                { value: "watch", label: t`Watched folder` },
                { value: "hook", label: t`Webhook in` },
                { value: "out", label: t`Events out` },
                { value: "api", label: "API token" },
              ]}
            />
          </div>
          {imports ? <ImportsBody tab={tab} imports={imports} projectCode={projectCode} /> : null}
          {imports && tab !== "out" ? (
            <Zone
              title={t`Last arrivals`}
              end={
                <Hint>
                  <Trans>Problems also show in notifications</Trans>
                </Hint>
              }
            >
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
          <Hint>
            <Trans>Every arrival goes through the same checks as an upload.</Trans>
          </Hint>
          <span className="flex-1" />
          <Button variant="primary" onClick={onClose}>
            <Trans>Done</Trans>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
