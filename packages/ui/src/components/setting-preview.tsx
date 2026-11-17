import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type SettingPreviewKind =
  | "tools"
  | "panelWidth"
  | "panelMoving"
  | "minimap"
  | "theme"
  | "density"
  | "home";

const width = 64;
const height = 40;
const top = 5;

const palettes = {
  dark: { frame: "#16181d", bar: "#23262d", part: "#2e323a", ink: "#8b919c" },
  light: { frame: "#f5f6f8", bar: "#e4e6ea", part: "#d3d6dc", ink: "#6b7280" },
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <rect
        x="0.5"
        y="0.5"
        width={width - 1}
        height={height - 1}
        rx="3"
        fill="var(--canvas)"
        stroke="var(--line-strong)"
      />
      <rect x="1" y="1" width={width - 2} height={top - 1} rx="2.5" fill="var(--chrome-2)" />
      {children}
    </>
  );
}

function Tissue({ right = width }: { right?: number }) {
  const centre = (right + 2) / 2;
  return (
    <ellipse
      cx={centre}
      cy={(height + top) / 2}
      rx={Math.min(14, (right - 6) / 2.6)}
      ry="9"
      fill="var(--c-tumor)"
      opacity="0.45"
    />
  );
}

function Panel({ size, faded = false }: { size: number; faded?: boolean }) {
  return (
    <rect
      x={width - 1 - size}
      y={top}
      width={size}
      height={height - top - 1}
      fill="var(--chrome-3)"
      opacity={faded ? 0.35 : 1}
      strokeDasharray={faded ? "2 1.5" : undefined}
      stroke={faded ? "var(--fg-faint)" : "none"}
      strokeWidth="0.6"
    />
  );
}

function ToolDots({ along }: { along: "column" | "row" }) {
  return (
    <>
      {[0, 1, 2, 3].map((index) =>
        along === "column" ? (
          <rect
            key={index}
            x="3"
            y={top + 3 + index * 5}
            width="3"
            height="3"
            rx="0.8"
            fill={index === 0 ? "var(--accent)" : "var(--fg-faint)"}
          />
        ) : (
          <rect
            key={index}
            x={18 + index * 5}
            y={height - 6}
            width="3"
            height="3"
            rx="0.8"
            fill={index === 0 ? "var(--accent)" : "var(--fg-faint)"}
          />
        ),
      )}
    </>
  );
}

function ToolsPreview({ option }: { option: string }) {
  return (
    <Frame>
      <Tissue right={width - 15} />
      <Panel size={14} />
      {option === "dock" ? (
        <>
          <rect
            x="15"
            y={height - 8}
            width="21"
            height="6"
            rx="2"
            fill="var(--chrome-3)"
            stroke="var(--line-strong)"
            strokeWidth="0.6"
          />
          <ToolDots along="row" />
        </>
      ) : (
        <>
          <rect x="1" y={top} width="7" height={height - top - 1} fill="var(--chrome-3)" />
          <ToolDots along="column" />
        </>
      )}
    </Frame>
  );
}

const panelSizes: Record<string, number> = { "300": 12, "340": 15, "420": 20 };

function PanelWidthPreview({ option }: { option: string }) {
  const size = panelSizes[option] ?? 15;
  return (
    <Frame>
      <Tissue right={width - size - 1} />
      <Panel size={size} />
    </Frame>
  );
}

function PanelMovingPreview({ option }: { option: string }) {
  const hides = option === "auto";
  return (
    <Frame>
      <Tissue right={hides ? width : width - 15} />
      <Panel size={14} faded={hides} />
      {hides ? (
        <path
          d="M14 30 h12 m-3 -2.5 l3 2.5 l-3 2.5"
          fill="none"
          stroke="var(--fg-dim)"
          strokeWidth="1"
          strokeLinecap="round"
        />
      ) : null}
    </Frame>
  );
}

function MinimapPreview({ option }: { option: string }) {
  return (
    <Frame>
      <ellipse cx="30" cy="23" rx="22" ry="13" fill="var(--c-tumor)" opacity="0.45" />
      {option === "never" ? null : (
        <g opacity={option === "useful" ? 0.55 : 1}>
          <rect
            x={width - 18}
            y={top + 2}
            width="15"
            height="11"
            rx="1.5"
            fill="var(--chrome)"
            stroke="var(--line-strong)"
            strokeWidth="0.6"
            strokeDasharray={option === "useful" ? "2 1.5" : undefined}
          />
          <rect
            x={width - 13}
            y={top + 5}
            width="5"
            height="4"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="0.8"
          />
        </g>
      )}
    </Frame>
  );
}

function ThemeHalf({ tone, clip }: { tone: keyof typeof palettes; clip?: string }) {
  const colors = palettes[tone];
  return (
    <g clipPath={clip}>
      <rect x="0.5" y="0.5" width={width - 1} height={height - 1} rx="3" fill={colors.frame} />
      <rect x="1" y="1" width={width - 2} height={top - 1} rx="2.5" fill={colors.bar} />
      <rect x={width - 16} y={top} width="15" height={height - top - 1} fill={colors.part} />
      <rect x="6" y="12" width="26" height="3" rx="1.5" fill={colors.ink} />
      <rect x="6" y="19" width="34" height="3" rx="1.5" fill={colors.ink} opacity="0.6" />
      <rect x="6" y="26" width="20" height="3" rx="1.5" fill={colors.ink} opacity="0.6" />
    </g>
  );
}

function ThemePreview({ option, id }: { option: string; id: string }) {
  if (option === "light" || option === "dark") {
    return (
      <>
        <ThemeHalf tone={option} />
        <rect
          x="0.5"
          y="0.5"
          width={width - 1}
          height={height - 1}
          rx="3"
          fill="none"
          stroke="var(--line-strong)"
        />
      </>
    );
  }
  return (
    <>
      <defs>
        <clipPath id={id}>
          <polygon points={`0,0 ${width},0 0,${height}`} />
        </clipPath>
      </defs>
      <ThemeHalf tone="dark" />
      <ThemeHalf tone="light" clip={`url(#${id})`} />
      <rect
        x="0.5"
        y="0.5"
        width={width - 1}
        height={height - 1}
        rx="3"
        fill="none"
        stroke="var(--line-strong)"
      />
    </>
  );
}

function DensityPreview({ option }: { option: string }) {
  const step = option === "compact" ? 5 : 8;
  const rows = Array.from({ length: Math.floor((height - top - 6) / step) }, (_, index) => index);
  return (
    <Frame>
      {rows.map((index) => (
        <g key={index}>
          <rect
            x="5"
            y={top + 4 + index * step}
            width="4"
            height="3"
            rx="1"
            fill="var(--fg-faint)"
          />
          <rect
            x="12"
            y={top + 4 + index * step}
            width={30 - (index % 2) * 8}
            height="3"
            rx="1.5"
            fill="var(--fg-faint)"
            opacity="0.7"
          />
        </g>
      ))}
    </Frame>
  );
}

function ListBlock({ x, w }: { x: number; w: number }) {
  return (
    <>
      {[0, 1, 2, 3].map((index) => (
        <rect
          key={index}
          x={x}
          y={top + 4 + index * 7}
          width={w}
          height="4"
          rx="1.2"
          fill="var(--chrome-3)"
        />
      ))}
    </>
  );
}

function GridBlock({ x, w }: { x: number; w: number }) {
  const cell = (w - 3) / 2;
  return (
    <>
      {[0, 1].map((row) =>
        [0, 1].map((column) => (
          <rect
            key={`${row}-${column}`}
            x={x + column * (cell + 3)}
            y={top + 4 + row * 14}
            width={cell}
            height="11"
            rx="1.5"
            fill="var(--chrome-3)"
          />
        )),
      )}
    </>
  );
}

function HomePreview({ option }: { option: string }) {
  return (
    <Frame>
      {option === "research" ? <GridBlock x={5} w={54} /> : null}
      {option === "review" ? <ListBlock x={5} w={54} /> : null}
      {option === "both" ? (
        <>
          <ListBlock x={5} w={25} />
          <GridBlock x={34} w={25} />
        </>
      ) : null}
      {option === "role" ? (
        <>
          <circle cx="10" cy={top + 7} r="3" fill="var(--accent)" />
          <rect x="16" y={top + 5} width="20" height="3" rx="1.5" fill="var(--fg-faint)" />
          <path
            d="M5 21 h20 M5 27 h14 M33 21 h26 M33 27 h20"
            stroke="var(--chrome-3)"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      ) : null}
    </Frame>
  );
}

type SettingPreviewProps = Omit<React.ComponentProps<"svg">, "children"> & {
  kind: SettingPreviewKind;
  option: string;
};

function SettingPreview({ kind, option, className, ...props }: SettingPreviewProps) {
  const id = `setting-preview-${kind}-${option}`;
  return (
    <svg
      data-slot="setting-preview"
      data-preview={`${kind}:${option}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
      focusable="false"
      className={cn("block shrink-0", className)}
      {...props}
    >
      {kind === "tools" ? <ToolsPreview option={option} /> : null}
      {kind === "panelWidth" ? <PanelWidthPreview option={option} /> : null}
      {kind === "panelMoving" ? <PanelMovingPreview option={option} /> : null}
      {kind === "minimap" ? <MinimapPreview option={option} /> : null}
      {kind === "theme" ? <ThemePreview option={option} id={id} /> : null}
      {kind === "density" ? <DensityPreview option={option} /> : null}
      {kind === "home" ? <HomePreview option={option} /> : null}
    </svg>
  );
}

function PreviewOption({
  kind,
  option,
  label,
}: {
  kind: SettingPreviewKind;
  option: string;
  label: React.ReactNode;
}) {
  return (
    <span data-slot="preview-option" className="flex flex-col items-center gap-1 py-0.5">
      <SettingPreview kind={kind} option={option} />
      <span>{label}</span>
    </span>
  );
}

export { PreviewOption, SettingPreview, type SettingPreviewKind, type SettingPreviewProps };
