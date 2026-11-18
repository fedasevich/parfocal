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

const width = 96;
const height = 60;
const top = 7;
const left = 1;
const right = width - 1;
const bottom = height - 1;
const stageHeight = bottom - top;

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
        rx="4"
        fill="var(--chrome)"
        stroke="var(--line-strong)"
      />
      <rect x="1" y="1" width={width - 2} height={top - 1} rx="3" fill="var(--chrome-2)" />
      {[0, 1, 2].map((index) => (
        <circle key={index} cx={5 + index * 4} cy="4" r="1.1" fill="var(--fg-faint)" />
      ))}
      <rect x={left} y={top} width={right - left} height={stageHeight} fill="var(--canvas)" />
      {children}
    </>
  );
}

function Tissue({ from = left, to = right }: { from?: number; to?: number }) {
  const rx = Math.min(24, (to - from - 6) / 2);
  return (
    <ellipse
      cx={(from + to) / 2}
      cy={(top + bottom) / 2}
      rx={Math.max(6, rx)}
      ry="15"
      fill="var(--c-tumor)"
      opacity="0.5"
    />
  );
}

function Panel({
  size,
  changing = false,
  ghost = false,
}: {
  size: number;
  changing?: boolean;
  ghost?: boolean;
}) {
  const x = right - size;
  return (
    <g>
      <rect
        x={x}
        y={top}
        width={size}
        height={stageHeight}
        fill={ghost ? "none" : changing ? "var(--accent-soft)" : "var(--chrome-2)"}
        stroke={changing ? "var(--accent)" : "var(--line-strong)"}
        strokeWidth="1"
        strokeDasharray={ghost ? "3 2" : undefined}
      />
      {ghost
        ? null
        : [0, 1, 2, 3].map((index) => (
            <rect
              key={index}
              x={x + 4}
              y={top + 6 + index * 7}
              width={Math.max(4, size - 8 - (index % 2) * 5)}
              height="3"
              rx="1.5"
              fill={changing ? "var(--accent)" : "var(--fg-faint)"}
              opacity={changing ? 0.7 : 0.6}
            />
          ))}
    </g>
  );
}

function ToolSquares({ along, x, y }: { along: "column" | "row"; x: number; y: number }) {
  return (
    <>
      {[0, 1, 2, 3].map((index) => (
        <rect
          key={index}
          x={along === "column" ? x : x + index * 8}
          y={along === "column" ? y + index * 8 : y}
          width="5"
          height="5"
          rx="1.2"
          fill={index === 0 ? "var(--accent)" : "var(--fg-dim)"}
        />
      ))}
    </>
  );
}

function ToolsPreview({ option }: { option: string }) {
  const panel = 22;
  if (option === "dock") {
    return (
      <Frame>
        <Tissue to={right - panel} />
        <Panel size={panel} />
        <rect
          x="22"
          y={bottom - 13}
          width="38"
          height="10"
          rx="3"
          fill="var(--accent-soft)"
          stroke="var(--accent)"
        />
        <ToolSquares along="row" x={27} y={bottom - 10.5} />
      </Frame>
    );
  }
  return (
    <Frame>
      <Tissue from={left + 12} to={right - panel} />
      <Panel size={panel} />
      <rect
        x={left}
        y={top}
        width="11"
        height={stageHeight}
        fill="var(--accent-soft)"
        stroke="var(--accent)"
      />
      <ToolSquares along="column" x={4} y={top + 5} />
    </Frame>
  );
}

const panelSizes: Record<string, number> = { "300": 18, "340": 27, "420": 40 };

function PanelWidthPreview({ option }: { option: string }) {
  const size = panelSizes[option] ?? 27;
  const x = right - size;
  return (
    <Frame>
      <Tissue to={x} />
      <Panel size={size} changing />
      <path
        d={`M${x + 3} ${bottom - 7} H${right - 3} M${x + 3} ${bottom - 10} V${bottom - 4} M${right - 3} ${bottom - 10} V${bottom - 4}`}
        stroke="var(--accent)"
        strokeWidth="1"
        fill="none"
      />
    </Frame>
  );
}

function PanelMovingPreview({ option }: { option: string }) {
  const hides = option === "auto";
  return (
    <Frame>
      <Tissue to={hides ? right : right - 24} />
      <Panel size={24} changing={!hides} ghost={hides} />
      <circle cx="40" cy="38" r="2.4" fill="var(--fg)" />
      <path
        d="M36 38 H18 M23 33 L18 38 L23 43"
        fill="none"
        stroke="var(--fg)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Frame>
  );
}

function MinimapPreview({ option, id }: { option: string; id: string }) {
  const zoomed = option !== "always";
  const boxX = right - 29;
  const boxY = top + 3;
  return (
    <Frame>
      <clipPath id={id}>
        <rect x={left} y={top} width={right - left} height={stageHeight} />
      </clipPath>
      <g clipPath={`url(#${id})`}>
        <ellipse
          cx="38"
          cy="36"
          rx={zoomed ? 44 : 22}
          ry={zoomed ? 30 : 15}
          fill="var(--c-tumor)"
          opacity="0.5"
        />
      </g>
      {option === "never" ? (
        <>
          <rect
            x={boxX}
            y={boxY}
            width="26"
            height="18"
            rx="2"
            fill="none"
            stroke="var(--fg-faint)"
            strokeDasharray="3 2"
          />
          <path
            d={`M${boxX + 9} ${boxY + 5} H${boxX + 17} L${boxX + 9} ${boxY + 13} H${boxX + 17}`}
            fill="none"
            stroke="var(--fg-dim)"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <rect
            x={boxX}
            y={boxY}
            width="26"
            height="18"
            rx="2"
            fill="var(--chrome)"
            stroke="var(--accent)"
            strokeWidth="1"
          />
          <ellipse
            cx={boxX + 13}
            cy={boxY + 9}
            rx="8"
            ry="5.5"
            fill="var(--c-tumor)"
            opacity="0.6"
          />
          <rect
            x={zoomed ? boxX + 9 : boxX + 3}
            y={zoomed ? boxY + 5 : boxY + 2.5}
            width={zoomed ? 8 : 20}
            height={zoomed ? 6 : 13}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.2"
          />
        </>
      )}
    </Frame>
  );
}

function ThemeHalf({ tone, clip }: { tone: keyof typeof palettes; clip?: string }) {
  const colors = palettes[tone];
  return (
    <g clipPath={clip}>
      <rect x="0.5" y="0.5" width={width - 1} height={height - 1} rx="4" fill={colors.frame} />
      <rect x="1" y="1" width={width - 2} height={top - 1} rx="3" fill={colors.bar} />
      <rect x={width - 24} y={top} width="23" height={stageHeight} fill={colors.part} />
      <rect x="8" y="17" width="38" height="4" rx="2" fill={colors.ink} />
      <rect x="8" y="26" width="50" height="4" rx="2" fill={colors.ink} opacity="0.6" />
      <rect x="8" y="35" width="30" height="4" rx="2" fill={colors.ink} opacity="0.6" />
    </g>
  );
}

function ThemePreview({ option, id }: { option: string; id: string }) {
  const outline = (
    <rect
      x="0.5"
      y="0.5"
      width={width - 1}
      height={height - 1}
      rx="4"
      fill="none"
      stroke="var(--line-strong)"
    />
  );
  if (option === "light" || option === "dark") {
    return (
      <>
        <ThemeHalf tone={option} />
        {outline}
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
      {outline}
    </>
  );
}

function DensityPreview({ option }: { option: string }) {
  const step = option === "compact" ? 6 : 11;
  const rows = Array.from({ length: Math.floor((stageHeight - 6) / step) }, (_, index) => index);
  return (
    <Frame>
      {rows.map((index) => (
        <g key={index}>
          <rect
            x="7"
            y={top + 5 + index * step}
            width="5"
            height="4"
            rx="1.2"
            fill="var(--fg-dim)"
          />
          <rect
            x="16"
            y={top + 5 + index * step}
            width={58 - (index % 2) * 14}
            height="4"
            rx="2"
            fill="var(--fg-faint)"
            opacity="0.8"
          />
        </g>
      ))}
    </Frame>
  );
}

function ListBlock({
  x,
  w,
  rows = 3,
  dashed = false,
}: {
  x: number;
  w: number;
  rows?: number;
  dashed?: boolean;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, index) => (
        <g key={index}>
          <rect
            x={x}
            y={top + 14 + index * 9}
            width={w}
            height="7"
            rx="2"
            fill="var(--chrome-3)"
            stroke={dashed ? "var(--fg-faint)" : "none"}
            strokeDasharray={dashed ? "2 1.5" : undefined}
          />
          <circle cx={x + 4} cy={top + 17.5 + index * 9} r="1.8" fill="var(--accent)" />
        </g>
      ))}
    </>
  );
}

function GridBlock({ x, w, dashed = false }: { x: number; w: number; dashed?: boolean }) {
  const columns = w > 50 ? 3 : 2;
  const cell = (w - (columns - 1) * 3) / columns;
  return (
    <>
      {[0, 1].map((row) =>
        Array.from({ length: columns }, (_, column) => (
          <g key={`${row}-${column}`}>
            <rect
              x={x + column * (cell + 3)}
              y={top + 14 + row * 20}
              width={cell}
              height="17"
              rx="2.5"
              fill="var(--chrome-3)"
              stroke={dashed ? "var(--fg-faint)" : "none"}
              strokeDasharray={dashed ? "2 1.5" : undefined}
            />
            <rect
              x={x + column * (cell + 3) + 3}
              y={top + 17 + row * 20}
              width={cell - 6}
              height="6"
              rx="1.5"
              fill="var(--c-tumor)"
              opacity="0.45"
            />
          </g>
        )),
      )}
    </>
  );
}

function Heading({ accent = true }: { accent?: boolean }) {
  return (
    <rect
      x="6"
      y={top + 4}
      width="30"
      height="4"
      rx="2"
      fill={accent ? "var(--accent)" : "var(--fg-faint)"}
    />
  );
}

function HomePreview({ option }: { option: string }) {
  return (
    <Frame>
      <Heading />
      {option === "research" ? <GridBlock x={6} w={84} /> : null}
      {option === "review" ? <ListBlock x={6} w={84} /> : null}
      {option === "both" ? (
        <>
          <ListBlock x={6} w={40} />
          <GridBlock x={50} w={40} />
        </>
      ) : null}
      {option === "role" ? (
        <>
          <circle cx="82" cy={top + 6} r="3.4" fill="var(--accent)" />
          <ListBlock x={6} w={40} dashed />
          <GridBlock x={50} w={40} dashed />
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
      {kind === "minimap" ? <MinimapPreview option={option} id={id} /> : null}
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
