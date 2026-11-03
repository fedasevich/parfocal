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
import { SlideStill } from "../review/slide-still.tsx";
import {
  benchParameters,
  benchRuns,
  bigSlides,
  colourMaps,
  csvColumns,
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

function Pick({ label, value, items }: { label: string; value: string; items: string[] }) {
  const [current, setCurrent] = useState(value);
  return (
    <Select value={current} onValueChange={(next) => setCurrent(String(next ?? value))}>
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
  const [values, setValues] = useState<Values>({});
  const text = (key: string, fallback: string) => {
    const value = values[key];
    return typeof value === "string" ? value : fallback;
  };
  const on = (key: string, fallback: boolean) => {
    const value = values[key];
    return typeof value === "boolean" ? value : fallback;
  };
  const set = (key: string, value: string | boolean) =>
    setValues((previous) => ({ ...previous, [key]: value }));
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

  const bodies: Record<DeveloperSection, () => ReactNode> = {
    renderer: () => (
      <>
        <DevZone
          title="Renderer"
          end={
            viv ? (
              <StatusTag tone="ok">Default</StatusTag>
            ) : (
              <Button variant="link" size="xs" onClick={() => onRenderer("viv")}>
                Back to Viv
              </Button>
            )
          }
        >
          <Segments
            label="Renderer"
            value={renderer}
            pairs={[
              ["viv", "Viv · WebGL2"],
              ["webgpu", "WebGPU"],
              ["deck", "deck.gl 9.4"],
            ]}
            onChange={(value) => onRenderer(value as Renderer)}
          />
          <span className="text-body-sm leading-[1.45] text-fg-dim">{rendererHints[renderer]}</span>
          <DevRow
            label="deck.gl backend"
            disabled={renderer !== "deck"}
            {...(renderer === "deck" ? {} : { hint: "Only for deck.gl 9.4" })}
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
          title="Viv switches"
          off={!viv}
          end={<StatusTag tone={viv ? "accent" : "neutral"}>Viv only</StatusTag>}
          note={viv ? undefined : "Pick Viv to change these."}
        >
          {tog("vivzarr", "Read Zarr on the main thread", false, "Off decodes in a worker")}
          {tog("vivtex", "Float textures", true)}
          {tog("msaa", "MSAA", true, "Smoother outline edges")}
          {tog("earcut", "Earcut triangulation", false, "For polygons with holes")}
        </DevZone>
        <DevZone
          title="Culling, sampling and motion"
          off={!gpu}
          end={<StatusTag tone={gpu ? "accent" : "neutral"}>WebGPU only</StatusTag>}
          note={gpu ? undefined : "Viv loads its own tiles, so these wait for the WebGPU renderer."}
        >
          <DevRow label="Culling">
            {seg(
              "cull",
              "Culling",
              [
                ["gpu", "GPU compute"],
                ["cpu", "CPU Flatbush"],
                ["none", "None"],
              ],
              "gpu",
            )}
          </DevRow>
          <DevRow label="Interpolation">
            {seg(
              "interp",
              "Interpolation",
              [
                ["auto", "Auto"],
                ["linear", "Linear"],
                ["nearest", "Nearest"],
              ],
              "auto",
            )}
          </DevRow>
          {tog(
            "prefetch",
            "Prefetch ahead of motion",
            true,
            "Loads tiles where the view is heading",
          )}
          {tog("vector", "Show the motion vector", false)}
        </DevZone>
        <DevZone title="Mouse wheel" note="Overrides the doctor's Settings while testing.">
          {seg(
            "wheel",
            "Mouse wheel",
            [
              ["auto", "Auto"],
              ["zoom", "Zoom"],
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
          <DevZone title="Open a slide">
            <DevRow label="From">
              {seg(
                "src",
                "From",
                [
                  ["sample", "Sample"],
                  ["local", "Local file"],
                  ["url", "Path or URL"],
                ],
                "sample",
              )}
            </DevRow>
            {source === "url" ? (
              <DevRow
                label="Path or URL"
                hint="Local paths, HTTPS with range requests, S3 and Azure"
              >
                <span className="flex w-full gap-2">
                  <Input
                    aria-label="Path or URL"
                    className="font-mono"
                    defaultValue="s3://fnvltava-scans/sentinel/tumor_090.tif"
                  />
                  <Button>Open</Button>
                </span>
              </DevRow>
            ) : source === "local" ? (
              <DevRow label="File" hint="Opens in this browser only. Nothing is uploaded.">
                <Button>
                  <Icon name="upload" />
                  Choose a file
                </Button>
              </DevRow>
            ) : (
              <DevRow label="Address" hint="Pick another sample below">
                <Input
                  aria-label="Address"
                  readOnly
                  className="font-mono"
                  value="https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0062A/6001240.zarr"
                />
              </DevRow>
            )}
            <DevRow label="Paged loading" hint="Auto pages annotations above 200,000 nuclei">
              {seg(
                "paged",
                "Paged loading",
                [
                  ["auto", "Auto"],
                  ["on", "On"],
                  ["off", "Off"],
                ],
                "auto",
              )}
            </DevRow>
          </DevZone>
          <DevZone
            title="Sample slides"
            end={<span className="text-caption text-fg-faint">20 samples</span>}
          >
            <div
              role="radiogroup"
              aria-label="Sample slides"
              className="grid grid-cols-2 gap-x-3 gap-y-1"
            >
              <div className="col-span-full px-2 pt-2 pb-0.5 text-caption font-semibold text-fg-dim">
                Formats
              </div>
              {sampleSlides.map(item)}
              <div className="col-span-full px-2 pt-2 pb-0.5 text-caption font-semibold text-fg-dim">
                Big slides
              </div>
              {bigSlides.map(item)}
            </div>
          </DevZone>
          <DevZone
            title="Files"
            note="Annotations and reviews on this slide, for tests and fixtures."
          >
            <div className="flex flex-wrap gap-2">
              <Button size="sm">
                <Icon name="download" />
                Save JSON
              </Button>
              <Button size="sm">
                <Icon name="download" />
                GeoJSON and .fgb
              </Button>
              <Button size="sm">
                <Icon name="download" />
                Review CSV
              </Button>
              <Button size="sm">
                <Icon name="upload" />
                Import
              </Button>
            </div>
          </DevZone>
        </>
      );
    },
    annot: () => (
      <>
        <DevZone title="Synthetic nuclei">
          <DevRow label="Count" hint="Off, 10k, 100k, 500k or 1M">
            <Pick label="Count" value="100k" items={["Off", "10k", "100k", "500k", "1M"]} />
          </DevRow>
          {live("100,000 nuclei queued in 41 ms")}
        </DevZone>
        <DevZone title="Level of detail">
          <DevRow
            label="Mode"
            hint="Off, fade, dots, density or tiered. Starts from 500 shapes. Density under 2 px, dots under 7 px, fade from 2 to 7 px."
          >
            <Pick
              label="Mode"
              value="Tiered"
              items={["Off", "Fade", "Dots", "Density", "Tiered"]}
            />
          </DevRow>
          <DevRow label="Fill opacity">
            <Level label="Fill opacity" value={35} text="35%" />
          </DevRow>
        </DevZone>
        <DevZone
          title="CAMELYON16 annotations"
          note="Real tumor outlines from CAMELYON16, drawn over the slide."
        >
          <div className="flex flex-wrap gap-2">
            {["T016", "T009", "T001", "T002"].map((name) => (
              <Button key={name} size="sm">
                {name}
              </Button>
            ))}
            <Button size="sm" variant="ghost">
              Clear
            </Button>
          </div>
          {live("T009 loaded · 14 rings · 2,210 vertices · 61 KB")}
        </DevZone>
        <DevZone title="Channels">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {[
              ["Channel 0", "ch0"],
              ["Channel 1", "ch1"],
              ["Channel 2", "ch2"],
              ["Annotations", "ann"],
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
      <DevZone title="Heatmap">
        {tog("heat", "Show the heatmap", true)}
        <DevRow label="Source">
          {seg(
            "hsrc",
            "Source",
            [
              ["syn", "Synthetic"],
              ["tumor", "Tumor map"],
            ],
            "tumor",
          )}
        </DevRow>
        <DevRow label="Colormap">
          {seg(
            "cmap",
            "Colormap",
            [
              ["viridis", "Viridis"],
              ["inferno", "Inferno"],
              ["turbo", "Turbo"],
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
        <DevRow label="Opacity">
          <Level label="Opacity" value={70} text="0.70" />
        </DevRow>
        <DevRow label="Threshold">
          <Level label="Threshold" value={8} text="0.08" />
        </DevRow>
        <DevRow label="Grid">
          {seg(
            "grid",
            "Grid",
            [
              ["128", "128"],
              ["256", "256"],
              ["512", "512"],
            ],
            "256",
          )}
        </DevRow>
        <DevRow label="Synthetic field" hint="A new random field for the synthetic source">
          <Button size="sm">Reseed</Button>
        </DevRow>
      </DevZone>
    ),
    models: () => (
      <>
        <DevZone title="Segmentation model">
          <DevRow
            label="Provider"
            hint="PathoSAM ViT-B, SlimSAM-77, flood fill, MONAI NuClick or watershed"
          >
            <Pick
              label="Provider"
              value="PathoSAM ViT-B"
              items={["PathoSAM ViT-B", "SlimSAM-77", "Flood fill", "MONAI NuClick", "Watershed"]}
            />
          </DevRow>
          <ProgressBar
            value={100}
            tone="ok"
            label="PathoSAM ViT-B weights · 358 MB"
            valueText="Cached"
          />
          <ProgressBar value={62} label="SlimSAM-77 weights · 38 MB" valueText="62%" />
        </DevZone>
        <DevZone title="Auto segmentation">
          <DevRow label="Intent">
            {seg(
              "intent",
              "Intent",
              [
                ["nuclei", "Nuclei"],
                ["cells", "Cells"],
                ["tissue", "Tissue"],
                ["region", "Region"],
              ],
              "nuclei",
            )}
          </DevRow>
          <DevRow label="Quality">
            {seg(
              "q",
              "Quality",
              [
                ["fast", "Fast"],
                ["best", "Best"],
              ],
              "best",
            )}
          </DevRow>
          <DevRow label="SAM batch size" hint="Auto picks it from free GPU memory">
            <Pick
              label="SAM batch size"
              value="Auto, now 8"
              items={["Auto, now 8", "1", "4", "8", "16"]}
            />
          </DevRow>
          {tog("hover", "Hover preview", true, "Shows the outline before you click")}
          {tog("seeds", "Seeds from a detector", true)}
          <DevRow label="Detector" hint="PathoSAM AIS, HoVer-Net, VISTA-2D or U-Net">
            <Pick
              label="Detector"
              value="PathoSAM AIS"
              items={["PathoSAM AIS", "HoVer-Net", "VISTA-2D", "U-Net"]}
            />
          </DevRow>
        </DevZone>
        <DevZone title="While moving">
          {tog("mpause", "Pause models while moving", true, "Resumes 200 ms after the slide stops")}
          {tog("prewarm", "Prewarm when idle", true, "Starts after 350 ms without input")}
        </DevZone>
        <DevZone title="MONAI server" end={<StatusTag tone="ok">Connected · 3 models</StatusTag>}>
          <DevRow label="Address">
            <Input aria-label="MONAI address" className="font-mono" defaultValue="/monai" />
          </DevRow>
          <DevRow label="Model">
            <Pick
              label="Model"
              value="nuclick"
              items={["nuclick", "segmentation", "classification"]}
            />
          </DevRow>
          <DevRow label="Device">
            {seg(
              "mdev",
              "Device",
              [
                ["auto", "Auto"],
                ["cpu", "CPU"],
                ["cuda", "GPU"],
              ],
              "auto",
            )}
          </DevRow>
          <DevRow label="Smallest outline">
            <Input aria-label="Smallest outline" className="w-28 font-mono" defaultValue="40 px²" />
          </DevRow>
          {tog(
            "pixels",
            "Send pixels",
            false,
            "Off sends the tile address and the server reads the slide itself",
          )}
        </DevZone>
      </>
    ),
    typing: () => (
      <>
        <DevZone title="Cell typing">
          <DevRow label="Typer">
            {seg(
              "typer",
              "Typer",
              [
                ["monai", "MONAI"],
                ["learned", "Learned"],
                ["hovernext", "HoVer-NeXt"],
              ],
              "hovernext",
            )}
          </DevRow>
          {tog("mreview", "MONAI review", false, "Checks up to 400 cells per pass")}
          <DevFigures
            items={[
              ["212", "learned"],
              ["380", "reviewed"],
              ["7", "classifier round"],
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm">Teach MONAI</Button>
            <Button size="sm">Forget learned</Button>
          </div>
        </DevZone>
        <DevZone
          title="Confidence"
          note="Doctors pick wording and outlines in Settings. These override them while testing."
        >
          <DevRow label="Display" hint="Off, mark, fade, bands or map">
            <Pick
              label="Confidence display"
              value="Fade"
              items={["Off", "Mark", "Fade", "Bands", "Map"]}
            />
          </DevRow>
          <DevRow label="Words">
            {seg(
              "words",
              "Words",
              [
                ["plain", "Plain"],
                ["percent", "Percent"],
                ["frequency", "Frequency"],
              ],
              "plain",
            )}
          </DevRow>
          <DevRow label="Tumor cutoff">
            <Input aria-label="Tumor cutoff" className="w-28 font-mono" defaultValue="0.20" />
          </DevRow>
          <DevRow label="Calibration">
            <StatusTag tone="ok">Calibrated · ECE 0.031</StatusTag>
            <DevStatus>sure 14,102 · likely 3,410 · unsure 726</DevStatus>
          </DevRow>
        </DevZone>
      </>
    ),
    job: () => (
      <>
        <DevZone title="Whole-slide job">
          <DevRow label="Scope">
            {seg(
              "scope",
              "Scope",
              [
                ["view", "View"],
                ["sel", "Selection"],
                ["slide", "Slide"],
              ],
              "slide",
            )}
          </DevRow>
          <DevRow label="Order">
            {seg(
              "order",
              "Order",
              [
                ["tumor", "Tumor first"],
                ["raster", "Raster"],
              ],
              "tumor",
            )}
          </DevRow>
          <DevRow label="Quality">
            {seg(
              "jq",
              "Job quality",
              [
                ["best", "Best"],
                ["fast", "Fast"],
              ],
              "best",
            )}
          </DevRow>
          <DevRow label="Views" hint="Eight averages rotated and flipped copies of each tile">
            {seg(
              "views",
              "Views",
              [
                ["1", "1"],
                ["8", "8"],
              ],
              "8",
            )}
          </DevRow>
          <DevRow label="Model">
            <Pick
              label="Job model"
              value="PathoSAM + HoVer-NeXt"
              items={["PathoSAM + HoVer-NeXt", "PathoSAM", "HoVer-NeXt"]}
            />
          </DevRow>
          <DevRow label="Typer">
            <Pick label="Job typer" value="HoVer-NeXt" items={["HoVer-NeXt", "MONAI", "Learned"]} />
          </DevRow>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary">
              Start
            </Button>
            <Button size="sm">Cancel</Button>
            <Button size="sm">
              <Icon name="upload" />
              Load a result
            </Button>
          </div>
        </DevZone>
        <DevZone title="Running" highlight>
          <ProgressBar value={38} label="Tile 712 of 1,880, tumor first" valueText="38%" />
          <DevStatus>41,220 cells so far · 3.1 tiles a second · about 6 min left</DevStatus>
        </DevZone>
      </>
    ),
    bench: () => (
      <>
        <DevZone
          title="Pan sweep"
          note="Pans a 180-step ellipse at this zoom, then waits 600 ms for tiles to settle."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary">
              Run pan sweep
            </Button>
            <DevStatus>Last run 14:02 · {route} · 100k nuclei · zoom 2</DevStatus>
          </div>
          <DevFigures
            items={[
              ["6.2 ms", "frame p50"],
              ["11.8 ms", "frame p95"],
              ["60", "fps"],
              ["412", "tiles resident"],
            ]}
          />
        </DevZone>
        <DevZone
          title="Runs"
          end={
            <Button size="sm">
              <Icon name="download" />
              Export CSV, 12 runs
            </Button>
          }
        >
          <table className="w-full border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-line text-left text-caption text-fg-faint">
                <th className="py-1.5 font-semibold">Renderer</th>
                {["Nuclei", "Zoom", "p50", "p95", "fps"].map((name) => (
                  <th key={name} className="py-1.5 text-right font-semibold">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono">
              {benchRuns.map(([name, nuclei, zoom, p50, p95, fps]) => (
                <tr key={name} className="border-b border-line last:border-b-0">
                  <td className="py-1.5 font-semibold text-fg">{name}</td>
                  <td className="py-1.5 text-right">{nuclei}</td>
                  <td className="py-1.5 text-right">{zoom}</td>
                  <td className="py-1.5 text-right">{p50} ms</td>
                  <td className="py-1.5 text-right">{p95} ms</td>
                  <td className="py-1.5 text-right">{fps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DevZone>
        <DevZone title="CSV columns">
          <div className="flex flex-wrap gap-1.5">
            {csvColumns.map((column) => (
              <code
                key={column}
                className="rounded-sm bg-chrome-3 px-1.5 py-0.5 font-mono text-caption"
              >
                {column}
              </code>
            ))}
          </div>
        </DevZone>
      </>
    ),
    hud: () => (
      <>
        <DevZone title="HUD">
          {tog("hud", "Show the HUD", true, "Refreshes every 250 ms")}
          <DevRow label="Corner">
            {seg(
              "corner",
              "Corner",
              [
                ["tl", "Top left"],
                ["tr", "Top right"],
                ["bl", "Bottom left"],
              ],
              "tl",
            )}
          </DevRow>
          <DevRow label="Frame probe">
            {seg(
              "probe",
              "Frame probe",
              [
                ["off", "Off"],
                ["on", "On"],
                ["graph", "With graph"],
              ],
              "off",
            )}
          </DevRow>
        </DevZone>
        <DevZone title="Readouts on the Viv route">
          <HudReadouts boxes={vivReadouts} />
        </DevZone>
        <DevZone
          title="Only on the WebGPU route"
          off={!gpu}
          end={<StatusTag tone={gpu ? "accent" : "neutral"}>WebGPU only</StatusTag>}
        >
          <HudReadouts boxes={webgpuReadouts} />
        </DevZone>
      </>
    ),
    ref: () => (
      <>
        <DevZone
          title="URL parameters"
          note={
            <>
              Add them to the viewer address, for example{" "}
              <code className="font-mono">?lab&amp;renderer=viv&amp;nuclei=100k</code>.
            </>
          }
        >
          <ReferenceTable rows={urlParameters} />
        </DevZone>
        <DevZone title="Model bench page">
          <ReferenceTable rows={benchParameters} />
        </DevZone>
        <DevZone
          title="Debug handle"
          note={
            <>
              In the browser console as <code className="font-mono">{debugHandleName}</code>.
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
        <span>Full viewer</span>
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
          summary="60 fps · frame 6.2 ms"
          className={cn(
            corner === "tr" && "right-[736px] left-auto",
            corner === "bl" && "top-auto bottom-4",
          )}
          lines={[
            ["source", "ome-zarr · 6.4 Gpx · 9 levels"],
            ["render", "2.1 ms · 412 tile loads"],
            ["nuclei", "18,240 drawn of 100,000"],
            ["net", "182 ms · decode 4.2 ms · 6 in flight"],
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
              {route} · {sample} · 9 levels · 100,000 nuclei
            </span>
            <span className="flex-1" />
            <span>60 fps</span>
          </>
        }
      >
        {bodies[section]()}
      </DeveloperDrawer>
    </main>
  );
}
