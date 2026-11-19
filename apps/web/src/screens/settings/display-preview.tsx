import type {
  ClassPalette,
  ColormapChoice,
  ConfidenceForm,
  TextSize,
} from "../../shell/display-defaults.ts";
import { safePalette } from "../../viewer/class-paint.ts";
import { colormapCssGradient } from "../../viewer/viewer-engine.ts";

const frame =
  "grid h-[60px] w-[96px] shrink-0 place-items-center overflow-hidden rounded-md border border-line-strong bg-canvas";

const sampleText = `Aa ${12}`;

const standardSwatches = ["#f87171", "#6ee7b7", "#c084fc", "#fbbf24"];

export function OpacityPreview({ value }: { value: number }) {
  return (
    <div className={frame} data-testid="preview-opacity" data-value={value}>
      <svg viewBox="0 0 96 60" width="96" height="60" aria-hidden="true" focusable="false">
        <ellipse cx="48" cy="30" rx="30" ry="18" fill="#f87171" fillOpacity={value / 100} />
        <ellipse
          cx="48"
          cy="30"
          rx="30"
          ry="18"
          fill="none"
          stroke="#f87171"
          strokeWidth="2"
          strokeOpacity={value / 100}
        />
      </svg>
    </div>
  );
}

export function HeatmapPreview({ value, colormap }: { value: number; colormap: ColormapChoice }) {
  return (
    <div
      className={frame}
      data-testid="preview-heatmap"
      data-colormap={colormap}
      data-value={value}
    >
      <div
        className="size-full"
        style={{
          background: `linear-gradient(90deg, ${colormapCssGradient(colormap, 9)})`,
          opacity: value / 100,
        }}
      />
    </div>
  );
}

export function ColormapStrip({ colormap }: { colormap: ColormapChoice }) {
  return (
    <span
      aria-hidden="true"
      data-testid="colormap-strip"
      className="block h-2 w-14 rounded-full"
      style={{ background: `linear-gradient(90deg, ${colormapCssGradient(colormap, 9)})` }}
    />
  );
}

const confidenceSample: Record<ConfidenceForm, string> = {
  number: "0.82",
  word: "Likely",
  color: "",
  hidden: "",
};

export function ConfidencePreview({ form }: { form: ConfidenceForm }) {
  return (
    <div className={frame} data-testid="preview-confidence" data-form={form}>
      {form === "color" ? (
        <span className="size-5 rounded-full" style={{ background: "#16a34a" }} />
      ) : form === "hidden" ? (
        <span className="h-px w-8 bg-fg-faint" />
      ) : (
        <span className="font-mono text-body-sm text-fg">{confidenceSample[form]}</span>
      )}
    </div>
  );
}

export function TextSizePreview({ size }: { size: TextSize }) {
  return (
    <div className={frame} data-testid="preview-text-size" data-size={size}>
      <span className="text-body text-fg">{sampleText}</span>
    </div>
  );
}

export function PalettePreview({ palette }: { palette: ClassPalette }) {
  const colours =
    palette === "safe"
      ? [safePalette[5], safePalette[1], safePalette[6], safePalette[0]]
      : standardSwatches;
  return (
    <div className={frame} data-testid="preview-palette" data-palette={palette}>
      <span className="flex gap-1.5">
        {colours.map((colour) => (
          <span key={colour} className="size-4 rounded-full" style={{ background: colour }} />
        ))}
      </span>
    </div>
  );
}
