import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type SettingPreviewKind = "tools";

const width = 96;
const height = 60;
const top = 7;
const left = 1;
const right = width - 1;
const bottom = height - 1;
const stageHeight = bottom - top;

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

function Panel({ size }: { size: number }) {
  const x = right - size;
  return (
    <g>
      <rect
        x={x}
        y={top}
        width={size}
        height={stageHeight}
        fill="var(--chrome-2)"
        stroke="var(--line-strong)"
        strokeWidth="1"
      />
      {[0, 1, 2, 3].map((index) => (
        <rect
          key={index}
          x={x + 4}
          y={top + 6 + index * 7}
          width={Math.max(4, size - 8 - (index % 2) * 5)}
          height="3"
          rx="1.5"
          fill="var(--fg-faint)"
          opacity={0.6}
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

type SettingPreviewProps = Omit<React.ComponentProps<"svg">, "children"> & {
  kind: SettingPreviewKind;
  option: string;
};

function SettingPreview({ kind, option, className, ...props }: SettingPreviewProps) {
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
