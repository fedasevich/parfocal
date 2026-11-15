import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import {
  DeveloperDrawer,
  DeveloperNav,
  DevFigures,
  DevRow,
  DevStatus,
  DevToggle,
  DevZone,
  HudReadouts,
  PerformanceHud,
} from "@parfocal/ui/components/developer-drawer";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { Slider } from "@parfocal/ui/components/slider";
import { StatusTag } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import { type ReactNode, useState } from "react";
import { debugHandleName } from "../../debug-handle.ts";
import {
  type LabSettings,
  labDefaults,
  labDetailLevels,
  setLabSetting,
  useLabSettings,
} from "../../lab/lab-settings.ts";
import {
  camelyonSlides,
  countOf,
  fieldChipFor,
  nucleiChipFor,
  syntheticCounts,
} from "../../lab/synthetic-data.ts";
import { type OutlineModeChoice, useOutlineMode } from "../../viewer/outline-mode.ts";
import { SlideStill } from "../review/slide-still.tsx";
import { BenchSection } from "./bench-section.tsx";
import {
  benchParameters,
  bigSlides,
  colourMaps,
  type DeveloperSection,
  debugHandle,
  developerNav,
  type Renderer,
  rendererHints,
  routeName,
  sampleSlides,
  urlParameters,
  vivReadouts,
  webgpuReadouts,
} from "./developer-data.ts";

type Values = Record<string, string | boolean>;

const labTextKeys = {
  cull: "culling",
  interp: "interpolation",
  nuclei: "nuclei",
  corner: "hudCorner",
} as const satisfies Record<string, keyof LabSettings>;

const labFlagKeys = {
  prefetch: "prefetch",
  vector: "motionVector",
  hud: "hud",
  mpause: "pauseModels",
} as const satisfies Record<string, keyof LabSettings>;

const isLabTextKey = (key: string): key is keyof typeof labTextKeys => key in labTextKeys;
const isLabFlagKey = (key: string): key is keyof typeof labFlagKeys => key in labFlagKeys;

const detailLabel = (level: LabSettings["detailLevel"]) =>
  `${level.slice(0, 1).toUpperCase()}${level.slice(1)}`;

const detailItems = labDetailLevels.map(detailLabel);

function Segments({
  label,
  value,
  pairs,
  onChange,
}: {
  label: string;
  value: string;
  pairs: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <SegmentedControl
      fill
      aria-label={label}
      className="justify-self-stretch"
      value={value}
      onValueChange={(next) => onChange(String(next))}
      options={pairs.map(([option, text]) => ({ value: option, label: text }))}
    />
  );
}

function Pick({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: string[];
  onChange?: (value: string) => void;
}) {
  const [current, setCurrent] = useState(value);
  return (
    <Select
      value={current}
      onValueChange={(next) => {
        const chosen = String(next ?? value);
        setCurrent(chosen);
        onChange?.(chosen);
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className="min-w-[200px]">
        <SelectValue>{current}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem key={item} value={item}>
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const confidenceItems: Readonly<Record<string, OutlineModeChoice | null>> = {
  Off: null,
  Mark: "mark-unsure",
  Fade: "fade",
  Bands: "bands",
  Map: null,
};

function ConfidenceDisplay() {
  const { t } = useLingui();

  const [mode, setMode] = useOutlineMode();
  const shown =
    Object.entries(confidenceItems).find(([, choice]) => choice === mode)?.[0] ?? t`Fade`;
  return (
    <Pick
      label={t`Confidence display`}
      value={shown}
      items={Object.keys(confidenceItems)}
      onChange={(item) => {
        const choice = confidenceItems[item];
        if (choice) setMode(choice);
      }}
    />
  );
}

function Level({ label, value, text }: { label: string; value: number; text: string }) {
  return (
    <div className="flex w-full items-center gap-2.5">
      <Slider className="flex-1" defaultValue={[value]} getAriaLabel={() => label} />
      <span className="min-w-10 text-right font-mono text-body-sm text-fg">{text}</span>
    </div>
  );
}

function ReferenceTable({ rows }: { rows: string[][] }) {
  return (
    <table className="w-full border-collapse font-mono text-caption">
      <tbody>
        {rows.map((cells) => (
          <tr key={cells[0]} className="border-b border-line last:border-b-0">
            {cells.map((cell, index) => (
              <td
                key={cell}
                className={cn(
                  "py-1.5 pr-3 align-top",
                  index === 0 ? "text-fg" : "font-sans text-body-sm text-fg-dim",
                )}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const live = (text: ReactNode) => <DevStatus live>{text}</DevStatus>;

type DeveloperScreenProps = {
  section: DeveloperSection;
  renderer: Renderer;
  onSection: (section: DeveloperSection) => void;
  onRenderer: (renderer: Renderer) => void;
  onClose: () => void;
};

export function DeveloperScreen({
  section,
  renderer,
  onSection,
  onRenderer,
  onClose,
}: DeveloperScreenProps) {
  const { t } = useLingui();

  const [values, setValues] = useState<Values>({});
  const lab = useLabSettings();
  const text = (key: string, fallback: string) => {
    if (isLabTextKey(key)) return lab[labTextKeys[key]];
    const value = values[key];
    return typeof value === "string" ? value : fallback;
  };
  const on = (key: string, fallback: boolean) => {
    if (isLabFlagKey(key)) return lab[labFlagKeys[key]];
    const value = values[key];
    return typeof value === "boolean" ? value : fallback;
  };
  const set = (key: string, value: string | boolean) => {
    if (isLabTextKey(key)) {
      const target = labTextKeys[key];
      setLabSetting(target, value as never);
      return;
    }
    if (isLabFlagKey(key)) {
      setLabSetting(labFlagKeys[key], value === true);
      return;
    }
    setValues((previous) => ({ ...previous, [key]: value }));
  };
  const seg = (key: string, label: string, pairs: [string, string][], fallback: string) => (
    <Segments
      label={label}
      value={text(key, fallback)}
      pairs={pairs}
      onChange={(value) => set(key, value)}
    />
  );
  const tog = (key: string, label: string, fallback: boolean, sub?: string) => (
    <DevToggle
      label={label}
      {...(sub ? { sub } : {})}
      checked={on(key, fallback)}
      onCheckedChange={(checked) => set(key, checked)}
    />
  );
  const viv = renderer === "viv";
  const gpu = renderer === "webgpu";
  const route = routeName(renderer, text("backend", "webgl"));
  const sample = text("sample", "IDR OME-Zarr");
  const hud = on("hud", true);
  const nucleiCount = countOf(lab.nuclei);
  const nucleiChip = nucleiChipFor(nucleiCount);
  const fieldChip = fieldChipFor(text("grid", "256"));

  const bodies: Record<DeveloperSection, () => ReactNode> = {
    renderer: () => (
      <>
        <DevZone
          title={t`Renderer`}
          end={
            viv ? (
              <StatusTag tone="ok">
                <Trans>Default</Trans>
              </StatusTag>
            ) : (
              <Button variant="link" size="xs" onClick={() => onRenderer("viv")}>
                <Trans>Back to Viv</Trans>
              </Button>
            )
          }
        >
          <Segments
            label={t`Renderer`}
            value={renderer}
            pairs={[
              ["viv", t`Viv · WebGL2`],
              ["webgpu", "WebGPU"],
              ["deck", "deck.gl 9.4"],
            ]}
            onChange={(value) => onRenderer(value as Renderer)}
          />
          <span className="text-body-sm leading-[1.45] text-fg-dim">{rendererHints[renderer]}</span>
          <DevRow
            label={t`deck.gl backend`}
            disabled={renderer !== "deck"}
            {...(renderer === "deck" ? {} : { hint: t`Only for deck.gl 9.4` })}
          >
            {seg(
              "backend",
              "deck.gl backend",
              [
                ["webgl", "WebGL2"],
                ["webgpu", "WebGPU"],
              ],
              "webgl",
            )}
          </DevRow>
        </DevZone>
        <DevZone
          title={t`Viv switches`}
          off={!viv}
          end={
            <StatusTag tone={viv ? "accent" : "neutral"}>
              <Trans>Viv only</Trans>
            </StatusTag>
          }
          note={viv ? undefined : t`Pick Viv to change these.`}
        >
          {tog("vivzarr", t`Read Zarr on the main thread`, false, t`Off decodes in a worker`)}
          {tog("vivtex", t`Float textures`, true)}
          {tog("msaa", "MSAA", true, t`Smoother outline edges`)}
          {tog("earcut", t`Earcut triangulation`, false, t`For polygons with holes`)}
        </DevZone>
        <DevZone
          title={t`Culling, sampling and motion`}
          off={!gpu}
          end={
            <StatusTag tone={gpu ? "accent" : "neutral"}>
              <Trans>WebGPU only</Trans>
            </StatusTag>
          }
          note={
            gpu ? undefined : t`Viv loads its own tiles, so these wait for the WebGPU renderer.`
          }
        >
          <DevRow label={t`Culling`}>
            {seg(
              "cull",
              t`Culling`,
              [
                ["gpu", "GPU compute"],
                ["cpu", "CPU Flatbush"],
                ["none", t`None`],
              ],
              "gpu",
            )}
          </DevRow>
          <DevRow label={t`Interpolation`}>
            {seg(
              "interp",
              t`Interpolation`,
              [
                ["auto", t`Auto`],
                ["linear", t`Linear`],
                ["nearest", t`Nearest`],
              ],
              "auto",
            )}
          </DevRow>
          {tog(
            "prefetch",
            t`Prefetch ahead of motion`,
            true,
            t`Loads tiles where the view is heading`,
          )}
          {tog("vector", t`Show the motion vector`, false)}
        </DevZone>
        <DevZone title={t`Mouse wheel`} note={t`Overrides the doctor's Settings while testing.`}>
          {seg(
            "wheel",
            t`Mouse wheel`,
            [
              ["auto", t`Auto`],
              ["zoom", t`Zoom`],
              ["pan", "Pan"],
            ],
            "auto",
          )}
        </DevZone>
      </>
    ),
    tiles: () => {
      const source = text("src", "sample");
      const item = ([name, detail]: [string, string]) => (
        <label
          key={name}
          className={cn(
            "grid cursor-pointer grid-cols-[16px_minmax(0,1fr)] items-center gap-2.25 rounded-md px-2 py-1.5 text-left hover:bg-[color-mix(in_srgb,var(--fg)_5%,transparent)] has-focus-visible:outline-2 has-focus-visible:outline-solid has-focus-visible:outline-(--accent)",
            sample === name && "bg-surf-hl hover:bg-surf-hl",
          )}
        >
          <input
            type="radio"
            name="sample-slide"
            className="sr-only"
            checked={sample === name}
            onChange={() => set("sample", name)}
          />
          <span
            className={cn(
              "size-3.5 rounded-full border border-line-strong",
              sample === name && "border-[4.5px] border-accent",
            )}
          />
          <span className="min-w-0">
            <b className="block truncate font-medium text-fg">{name}</b>
            <small className="block truncate text-caption text-fg-faint">{detail}</small>
          </span>
        </label>
      );
      return (
        <>
          <DevZone title={t`Open a slide`}>
            <DevRow label={t`From`}>
              {seg(
                "src",
                t`From`,
                [
                  ["sample", t`Sample`],
                  ["local", t`Local file`],
                  ["url", t`Path or URL`],
                ],
                "sample",
              )}
            </DevRow>
            {source === "url" ? (
              <DevRow
                label={t`Path or URL`}
                hint={t`Local paths, HTTPS with range requests, S3 and Azure`}
              >
                <span className="flex w-full gap-2">
                  <Input
                    aria-label={t`Path or URL`}
                    className="font-mono"
                    defaultValue="s3://fnvltava-scans/sentinel/tumor_090.tif"
                  />
                  <Button>
                    <Trans>Open</Trans>
                  </Button>
                </span>
              </DevRow>
            ) : source === "local" ? (
              <DevRow label={t`File`} hint={t`Opens in this browser only. Nothing is uploaded.`}>
                <Button>
                  <Icon name="upload" />
                  <Trans>Choose a file</Trans>
                </Button>
              </DevRow>
            ) : (
              <DevRow label={t`Address`} hint={t`Pick another sample below`}>
                <Input
                  aria-label={t`Address`}
                  readOnly
                  className="font-mono"
                  value="https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0062A/6001240.zarr"
                />
              </DevRow>
            )}
            <DevRow label={t`Paged loading`} hint={t`Auto pages annotations above 200,000 nuclei`}>
              {seg(
                "paged",
                t`Paged loading`,
                [
                  ["auto", t`Auto`],
                  ["on", "On"],
                  ["off", "Off"],
                ],
                "auto",
              )}
            </DevRow>
          </DevZone>
          <DevZone
            title={t`Sample slides`}
            end={
              <span className="text-caption text-fg-faint">
                <Trans>20 samples</Trans>
              </span>
            }
          >
            <div
              role="radiogroup"
              aria-label={t`Sample slides`}
              className="grid grid-cols-2 gap-x-3 gap-y-1"
            >
              <div className="col-span-full px-2 pt-2 pb-0.5 text-caption font-semibold text-fg-dim">
                <Trans>Formats</Trans>
              </div>
              {sampleSlides.map(item)}
              <div className="col-span-full px-2 pt-2 pb-0.5 text-caption font-semibold text-fg-dim">
                <Trans>Big slides</Trans>
              </div>
              {bigSlides.map(item)}
            </div>
          </DevZone>
          <DevZone
            title={t`Files`}
            note={t`Annotations and reviews on this slide, for tests and fixtures.`}
          >
            <div className="flex flex-wrap gap-2">
              <Button size="sm">
                <Icon name="download" />
                <Trans>Save JSON</Trans>
              </Button>
              <Button size="sm">
                <Icon name="download" />
                <Trans>GeoJSON and .fgb</Trans>
              </Button>
              <Button size="sm">
                <Icon name="download" />
                <Trans>Review CSV</Trans>
              </Button>
              <Button size="sm">
                <Icon name="upload" />
                <Trans>Import</Trans>
              </Button>
            </div>
          </DevZone>
        </>
      );
    },
    annot: () => (
      <>
        <DevZone
          title={t`Synthetic nuclei`}
          end={nucleiChip ? <StatusTag tone="accent">{nucleiChip}</StatusTag> : null}
        >
          <DevRow label={t`Count`} hint={t`Off, 10k, 100k, 500k or 1M`}>
            <Pick
              label={t`Count`}
              value={syntheticCounts.find((entry) => entry.key === lab.nuclei)?.label ?? ""}
              items={syntheticCounts.map((entry) => entry.label)}
              onChange={(next) =>
                set("nuclei", syntheticCounts.find((entry) => entry.label === next)?.key ?? "off")
              }
            />
          </DevRow>
          {live(t`${nucleiCount.toLocaleString("en-US")} nuclei queued`)}
        </DevZone>
        <DevZone title={t`Level of detail`}>
          <DevRow
            label={t`Mode`}
            hint={t`Off, fade, dots, density or tiered. Starts from 500 shapes. Density under 2 px, dots under 7 px, fade from 2 to 7 px.`}
          >
            <Pick
              label={t`Mode`}
              value={detailLabel(lab.detailLevel)}
              items={detailItems}
              onChange={(next) =>
                setLabSetting(
                  "detailLevel",
                  labDetailLevels.find((level) => detailLabel(level) === next) ??
                    labDefaults.detailLevel,
                )
              }
            />
          </DevRow>
          <DevRow label={t`Fill opacity`}>
            <Level label={t`Fill opacity`} value={35} text="35%" />
          </DevRow>
        </DevZone>
        <DevZone
          title={t`CAMELYON16 annotations`}
          note={t`Real tumor outlines from CAMELYON16, drawn over the slide.`}
        >
          <div className="flex flex-wrap gap-2">
            {camelyonSlides.map((name) => (
              <Button key={name} size="sm">
                {name}
              </Button>
            ))}
            <Button size="sm" variant="ghost">
              <Trans>Clear</Trans>
            </Button>
          </div>
          {live(t`T009 loaded · 14 rings · 2,210 vertices · 61 KB`)}
        </DevZone>
        <DevZone title={t`Channels`}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {[
              ["Channel 0", "ch0"],
              ["Channel 1", "ch1"],
              ["Channel 2", "ch2"],
              [t`Annotations`, "ann"],
            ].map(([name, key]) => (
              <div key={key} className="rounded-ctl border border-line bg-surf-panel px-2.5 py-1.5">
                {tog(key ?? "", name ?? "", true)}
              </div>
            ))}
          </div>
        </DevZone>
      </>
    ),
    heatmap: () => (
      <DevZone title={t`Heatmap`}>
        {tog("heat", t`Show the heatmap`, true)}
        <DevRow label={t`Source`}>
          {seg(
            "hsrc",
            t`Source`,
            [
              ["syn", t`Synthetic`],
              ["tumor", t`Tumor map`],
            ],
            "tumor",
          )}
        </DevRow>
        <DevRow label={t`Colormap`}>
          {seg(
            "cmap",
            t`Colormap`,
            [
              ["viridis", t`Viridis`],
              ["inferno", t`Inferno`],
              ["turbo", t`Turbo`],
            ],
            "viridis",
          )}
          <span
            className="h-2 w-full rounded"
            style={{
              background: `linear-gradient(90deg, ${colourMaps[text("cmap", "viridis")] ?? ""})`,
            }}
          />
        </DevRow>
        <DevRow label={t`Opacity`}>
          <Level label={t`Opacity`} value={70} text="0.70" />
        </DevRow>
        <DevRow label={t`Threshold`}>
          <Level label={t`Threshold`} value={8} text="0.08" />
        </DevRow>
        <DevRow label={t`Grid`}>
          {seg(
            "grid",
            t`Grid`,
            [
              ["128", "128"],
              ["256", "256"],
              ["512", "512"],
            ],
            "256",
          )}
        </DevRow>
        <DevRow label={t`Synthetic field`} hint={t`A new random field for the synthetic source`}>
          {text("hsrc", "tumor") === "syn" ? (
            <StatusTag tone="accent">{fieldChip}</StatusTag>
          ) : null}
          <Button size="sm">
            <Trans>Reseed</Trans>
          </Button>
        </DevRow>
      </DevZone>
    ),
    models: () => (
      <>
        <DevZone title={t`Segmentation model`}>
          <DevRow
            label={t`Provider`}
            hint={t`PathoSAM ViT-B, SlimSAM-77, flood fill, MONAI NuClick or watershed`}
          >
            <Pick
              label={t`Provider`}
              value="PathoSAM ViT-B"
              items={["PathoSAM ViT-B", "SlimSAM-77", t`Flood fill`, "MONAI NuClick", t`Watershed`]}
            />
          </DevRow>
          <ProgressBar
            value={100}
            tone="ok"
            label={t`PathoSAM ViT-B weights · 358 MB`}
            valueText={t`Cached`}
          />
          <ProgressBar value={62} label={t`SlimSAM-77 weights · 38 MB`} valueText="62%" />
        </DevZone>
        <DevZone title={t`Auto segmentation`}>
          <DevRow label={t`Intent`}>
            {seg(
              "intent",
              t`Intent`,
              [
                ["nuclei", t`Nuclei`],
                ["cells", t`Cells`],
                ["tissue", t`Tissue`],
                ["region", t`Region`],
              ],
              "nuclei",
            )}
          </DevRow>
          <DevRow label={t`Quality`}>
            {seg(
              "q",
              t`Quality`,
              [
                ["fast", t`Fast`],
                ["best", t`Best`],
              ],
              "best",
            )}
          </DevRow>
          <DevRow label={t`SAM batch size`} hint={t`Auto picks it from free GPU memory`}>
            <Pick
              label={t`SAM batch size`}
              value={t`Auto, now 8`}
              items={[t`Auto, now 8`, "1", "4", "8", "16"]}
            />
          </DevRow>
          {tog("hover", t`Hover preview`, true, t`Shows the outline before you click`)}
          {tog("seeds", t`Seeds from a detector`, true)}
          <DevRow label={t`Detector`} hint={t`PathoSAM AIS, HoVer-Net, VISTA-2D or U-Net`}>
            <Pick
              label={t`Detector`}
              value="PathoSAM AIS"
              items={["PathoSAM AIS", "HoVer-Net", "VISTA-2D", "U-Net"]}
            />
          </DevRow>
        </DevZone>
        <DevZone title={t`While moving`}>
          {tog(
            "mpause",
            t`Pause models while moving`,
            true,
            t`Resumes 200 ms after the slide stops`,
          )}
          {tog("prewarm", t`Prewarm when idle`, true, t`Starts after 350 ms without input`)}
        </DevZone>
        <DevZone
          title={t`MONAI server`}
          end={
            <StatusTag tone="ok">
              <Trans>Connected · 3 models</Trans>
            </StatusTag>
          }
        >
          <DevRow label={t`Address`}>
            <Input aria-label={t`MONAI address`} className="font-mono" defaultValue="/monai" />
          </DevRow>
          <DevRow label={t`Model`}>
            <Pick
              label={t`Model`}
              value="nuclick"
              items={["nuclick", "segmentation", "classification"]}
            />
          </DevRow>
          <DevRow label={t`Device`}>
            {seg(
              "mdev",
              t`Device`,
              [
                ["auto", t`Auto`],
                ["cpu", "CPU"],
                ["cuda", "GPU"],
              ],
              "auto",
            )}
          </DevRow>
          <DevRow label={t`Smallest outline`}>
            <Input
              aria-label={t`Smallest outline`}
              className="w-28 font-mono"
              defaultValue="40 px²"
            />
          </DevRow>
          {tog(
            "pixels",
            t`Send pixels`,
            false,
            t`Off sends the tile address and the server reads the slide itself`,
          )}
        </DevZone>
      </>
    ),
    typing: () => (
      <>
        <DevZone title={t`Cell typing`}>
          <DevRow label={t`Typer`}>
            {seg(
              "typer",
              t`Typer`,
              [
                ["monai", "MONAI"],
                ["learned", t`Learned`],
                ["hovernext", "HoVer-NeXt"],
              ],
              "hovernext",
            )}
          </DevRow>
          {tog("mreview", "MONAI review", false, t`Checks up to 400 cells per pass`)}
          <DevFigures
            items={[
              ["212", "learned"],
              ["380", "reviewed"],
              ["7", "classifier round"],
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm">
              <Trans>Teach MONAI</Trans>
            </Button>
            <Button size="sm">
              <Trans>Forget learned</Trans>
            </Button>
          </div>
        </DevZone>
        <DevZone
          title={t`Confidence`}
          note={t`Doctors pick wording and outlines in Settings. These override them while testing.`}
        >
          <DevRow label={t`Display`} hint={t`Off, mark, fade, bands or map`}>
            <ConfidenceDisplay />
          </DevRow>
          <DevRow label={t`Words`}>
            {seg(
              "words",
              t`Words`,
              [
                ["plain", t`Plain`],
                ["percent", t`Percent`],
                ["frequency", t`Frequency`],
              ],
              "plain",
            )}
          </DevRow>
          <DevRow label={t`Tumor cutoff`}>
            <Input aria-label={t`Tumor cutoff`} className="w-28 font-mono" defaultValue="0.20" />
          </DevRow>
          <DevRow label={t`Calibration`}>
            <StatusTag tone="ok">
              <Trans>Calibrated · ECE 0.031</Trans>
            </StatusTag>
            <DevStatus>
              <Trans>sure 14,102 · likely 3,410 · unsure 726</Trans>
            </DevStatus>
          </DevRow>
        </DevZone>
      </>
    ),
    job: () => (
      <>
        <DevZone title={t`Whole-slide job`}>
          <DevRow label={t`Scope`}>
            {seg(
              "scope",
              t`Scope`,
              [
                ["view", t`View`],
                ["sel", t`Selection`],
                ["slide", t`Slide`],
              ],
              "slide",
            )}
          </DevRow>
          <DevRow label={t`Order`}>
            {seg(
              "order",
              t`Order`,
              [
                ["tumor", t`Tumor first`],
                ["raster", t`Raster`],
              ],
              "tumor",
            )}
          </DevRow>
          <DevRow label={t`Quality`}>
            {seg(
              "jq",
              t`Job quality`,
              [
                ["best", t`Best`],
                ["fast", t`Fast`],
              ],
              "best",
            )}
          </DevRow>
          <DevRow label={t`Views`} hint={t`Eight averages rotated and flipped copies of each tile`}>
            {seg(
              "views",
              t`Views`,
              [
                ["1", "1"],
                ["8", "8"],
              ],
              "8",
            )}
          </DevRow>
          <DevRow label={t`Model`}>
            <Pick
              label={t`Job model`}
              value={t`PathoSAM + HoVer-NeXt`}
              items={[t`PathoSAM + HoVer-NeXt`, "PathoSAM", "HoVer-NeXt"]}
            />
          </DevRow>
          <DevRow label={t`Typer`}>
            <Pick
              label={t`Job typer`}
              value="HoVer-NeXt"
              items={["HoVer-NeXt", "MONAI", t`Learned`]}
            />
          </DevRow>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary">
              <Trans>Start</Trans>
            </Button>
            <Button size="sm">
              <Trans>Cancel</Trans>
            </Button>
            <Button size="sm">
              <Icon name="upload" />
              <Trans>Load a result</Trans>
            </Button>
          </div>
        </DevZone>
        <DevZone title={t`Running`} highlight>
          <ProgressBar value={38} label={t`Tile 712 of 1,880, tumor first`} valueText="38%" />
          <DevStatus>
            <Trans>41,220 cells so far · 3.1 tiles a second · about 6 min left</Trans>
          </DevStatus>
        </DevZone>
      </>
    ),
    bench: () => <BenchSection route={route} />,
    hud: () => (
      <>
        <DevZone title={t`HUD`}>
          {tog("hud", t`Show the HUD`, true, t`Refreshes every 250 ms`)}
          <DevRow label={t`Corner`}>
            {seg(
              "corner",
              t`Corner`,
              [
                ["tl", t`Top left`],
                ["tr", t`Top right`],
                ["bl", t`Bottom left`],
              ],
              "tl",
            )}
          </DevRow>
          <DevRow label={t`Frame probe`}>
            {seg(
              "probe",
              t`Frame probe`,
              [
                ["off", "Off"],
                ["on", "On"],
                ["graph", t`With graph`],
              ],
              "off",
            )}
          </DevRow>
        </DevZone>
        <DevZone title={t`Readouts on the Viv route`}>
          <HudReadouts boxes={vivReadouts} />
        </DevZone>
        <DevZone
          title={t`Only on the WebGPU route`}
          off={!gpu}
          end={
            <StatusTag tone={gpu ? "accent" : "neutral"}>
              <Trans>WebGPU only</Trans>
            </StatusTag>
          }
        >
          <HudReadouts boxes={webgpuReadouts} />
        </DevZone>
      </>
    ),
    ref: () => (
      <>
        <DevZone
          title={t`URL parameters`}
          note={
            <>
              <Trans>
                Add them to the viewer address, for example{" "}
                <code className="font-mono">?lab&amp;renderer=viv&amp;nuclei=100k</code>
              </Trans>
              .
            </>
          }
        >
          <ReferenceTable rows={urlParameters} />
        </DevZone>
        <DevZone title={t`Model bench page`}>
          <ReferenceTable rows={benchParameters} />
        </DevZone>
        <DevZone
          title={t`Debug handle`}
          note={
            <>
              <Trans>
                In the browser console as <code className="font-mono">{debugHandleName}</code>
              </Trans>
              .
            </>
          }
        >
          <ReferenceTable rows={debugHandle} />
        </DevZone>
      </>
    ),
  };

  const corner = text("corner", "tl");
  return (
    <main className="relative h-screen overflow-hidden bg-canvas">
      <header className="flex h-11 items-center gap-2 border-b border-line bg-chrome px-3 text-body-sm text-fg-dim">
        <Icon name="parfocal" />
        <span>
          <Trans>Full viewer</Trans>
        </span>
      </header>
      <div className="absolute inset-x-0 top-11 bottom-0" aria-hidden="true" inert>
        <SlideStill
          view={{ kind: "whole" }}
          camera={null}
          onCameraChange={() => undefined}
          regionDecisions={{}}
          bare
          minimap={false}
          hint={false}
          className="h-full"
        />
      </div>
      {hud ? (
        <PerformanceHud
          route={route}
          summary={t`60 fps · frame 6.2 ms`}
          className={cn(
            corner === "tr" && "right-[736px] left-auto",
            corner === "bl" && "top-auto bottom-4",
          )}
          lines={[
            ["source", t`ome-zarr · 6.4 Gpx · 9 levels`],
            ["render", t`2.1 ms · 412 tile loads`],
            ["nuclei", t`18,240 drawn of 100,000`],
            ["net", t`182 ms · decode 4.2 ms · 6 in flight`],
          ]}
        />
      ) : null}
      <DeveloperDrawer
        onClose={onClose}
        nav={
          <DeveloperNav
            groups={developerNav}
            value={section}
            onValueChange={(value) => onSection(value as DeveloperSection)}
          />
        }
        footer={
          <>
            <i className="size-2 rounded-full bg-ok" />
            <span>
              <Trans>
                {route} · {sample} · 9 levels · 100,000 nuclei
              </Trans>
            </span>
            <span className="flex-1" />
            <span>
              <Trans>60 fps</Trans>
            </span>
          </>
        }
      >
        {bodies[section]()}
      </DeveloperDrawer>
    </main>
  );
}
