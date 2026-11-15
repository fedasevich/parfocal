import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  getGetResultsSchemaUrl,
  getGetResultsTemplateUrl,
  type UploadBatch,
} from "@parfocal/api-client";
import { Button, buttonVariants } from "@parfocal/ui/components/button";
import { DrawerPanel } from "@parfocal/ui/components/drawer-panel";
import { Icon } from "@parfocal/ui/components/icon";
import { Hint, Zone } from "@parfocal/ui/components/zone";
import { lazyText } from "@parfocal/ui/lib/lazy-text";
import type { ReactNode } from "react";
import { CheckRow, FileIcon, FileList, FileRow } from "./parts.tsx";

const errorCodes = lazyText(() => [
  ["not-json", t`The file is not valid JSON. The line shows where reading stopped.`],
  ["wrong-format", t`The "format" field must be "parfocal-results".`],
  ["wrong-version", t`The "version" field must be 1.`],
  ["missing-field", t`A required field is absent.`],
  ["unknown-field", t`A field the schema does not define. Remove or rename it.`],
  ["wrong-type", t`A value has the wrong type, such as text where a number goes.`],
  ["out-of-range", t`A number is outside its allowed range, such as a score above 1.`],
  ["bad-length", t`A text or list is too short or too long.`],
  ["not-allowed", t`A value is not one of the allowed choices.`],
  ["bad-pattern", t`A text, such as an ID, does not match the expected pattern.`],
]);

export default function FormatsDrawer({
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
  const { t } = useLingui();

  const formats = [
    ["Parfocal JSON", t`Regions, cells, classes, scores and IDs in one file. The native format.`],
    [
      t`GeoJSON or a QuPath export`,
      t`Polygons and points. QuPath classes and measurements are kept.`,
    ],
    [t`CSV or TSV`, t`One row per cell with x, y and a class.`],
    [
      t`Masks or heatmaps`,
      t`PNG or TIFF at one pyramid level. The level is checked with an overlay.`,
    ],
  ];
  return (
    <DrawerPanel
      scrim
      label={t`What files work?`}
      title={t`What files work?`}
      width={520}
      testId="formats-drawer"
      onClose={onClose}
    >
      <Zone title={t`Slides`}>
        <Hint>
          <Trans>
            Whole-slide images as the scanner writes them, up to 20 GB each: Aperio SVS, Hamamatsu
            NDPI, 3DHISTECH MRXS, pyramidal TIFF and OME-TIFF, Zeiss CZI, Philips iSyntax and DICOM
            WSI.
          </Trans>
        </Hint>
      </Zone>
      <Zone
        title={
          <>
            <Trans>
              AI results <span className="ml-1.5 font-normal text-fg-dim">optional</span>
            </Trans>
          </>
        }
        sub={t`A result file goes with the slide that has the same name, or whose ID is inside the file.`}
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
          <Hint>
            <Trans>Templates</Trans>
          </Hint>
          <span className="flex-1" />
          <a
            className={buttonVariants()}
            href={getGetResultsTemplateUrl()}
            download="parfocal-results.template.json"
          >
            <Icon name="download" />
            <Trans>Parfocal JSON</Trans>
          </a>
          <Button onClick={() => toast(t`Downloads cells.template.csv (mock)`)}>
            <Icon name="download" />
            <Trans>CSV</Trans>
          </Button>
          <a
            className={buttonVariants({ variant: "ghost" })}
            href={getGetResultsSchemaUrl()}
            download="parfocal-results-v1.schema.json"
          >
            <Trans>JSON Schema</Trans>
          </a>
        </div>
      </Zone>
      <Zone
        title={t`If a Parfocal JSON file is rejected`}
        sub={t`Each problem names its line and one of these codes.`}
      >
        <FileList>
          {errorCodes.map(([code, text]) => (
            <div
              key={code}
              data-testid="error-code"
              className="grid gap-0.75 border-line px-3.5 py-2.5 [&+&]:border-t"
            >
              <b className="font-mono text-body-sm font-semibold">{code}</b>
              <small className="text-body-sm leading-[1.4] text-fg-dim">{text}</small>
            </div>
          ))}
        </FileList>
      </Zone>
      <Zone title={t`Check a file`}>
        {checking ? (
          <>
            <FileList>
              <FileRow
                lead={<FileIcon />}
                name={batch.format_check.file}
                detail={batch.format_check.detail}
                end={
                  <Button size="sm" variant="ghost" onClick={onClear}>
                    <Trans>Clear</Trans>
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
            <b className="text-body font-semibold text-fg">
              <Trans>Drop a result file</Trans>
            </b>
            <span>
              <Trans>See what Parfocal makes of it. Nothing is imported.</Trans>
            </span>
          </button>
        )}
      </Zone>
    </DrawerPanel>
  );
}
