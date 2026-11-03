import type { ReviewObject } from "@parfocal/api-client";
import { CellsPanel } from "@parfocal/ui/components/cells-panel";
import { GalleryTile } from "@parfocal/ui/components/gallery-tile";
import { lookUrl } from "../thumbnails.ts";
import { reviewTyper } from "./ai-wording.ts";
import type { Answer } from "./review-state.ts";
import { cellShapes, hpfSize } from "./slide-geometry.ts";

const tile = 40;
const zoom = 1.4;

export function cropStyle(object: string) {
  const cell = cellShapes[object];
  const x = (cell?.x ?? 0) * zoom - tile / 2;
  const y = (cell?.y ?? 0) * zoom - tile / 2;
  return {
    imagePosition: `${-x}px ${-y}px`,
    imageSize: `${hpfSize.width * zoom}px ${hpfSize.height * zoom}px`,
  };
}

export function CellOutline({ object, white = false }: { object: string; white?: boolean }) {
  const cell = cellShapes[object];
  if (cell === undefined) return null;
  const half = tile / 2 / zoom;
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 size-full"
      viewBox={`${cell.x - half} ${cell.y - half} ${half * 2} ${half * 2}`}
    >
      <path
        d={cell.path}
        fill="none"
        stroke={white ? "#ffffff" : "var(--c-tumor)"}
        strokeWidth={1.5 / zoom}
      />
    </svg>
  );
}

type CellsGridProps = {
  cells: ReviewObject[];
  current: string | undefined;
  answer: (object: string) => Answer | undefined;
  answerKeys: string[];
  claimHidden: boolean;
  folded: boolean;
  confirming: boolean;
  onPick: (object: string) => void;
  onAgreeRest: () => void;
  onApplyRest: () => void;
  onCancelRest: () => void;
  onFoldChange: (folded: boolean) => void;
  onClose: () => void;
  className?: string;
};

export function CellsGrid({
  cells,
  current,
  answer,
  answerKeys,
  claimHidden,
  folded,
  confirming,
  onPick,
  onAgreeRest,
  onApplyRest,
  onCancelRest,
  onFoldChange,
  onClose,
  className,
}: CellsGridProps) {
  const open = cells.filter((cell) => !answer(cell.object));
  return (
    <CellsPanel
      className={className}
      decided={cells.length - open.length}
      total={cells.length}
      answerKeys={answerKeys}
      folded={folded}
      confirmRest={confirming ? open.length : undefined}
      canAgreeRest={!claimHidden}
      onAgreeRest={onAgreeRest}
      onApplyRest={onApplyRest}
      onCancelRest={onCancelRest}
      onFoldChange={onFoldChange}
      onClose={onClose}
    >
      {cells.map((cell) => {
        const value = answer(cell.object)?.value;
        return (
          <GalleryTile
            key={cell.object}
            size={40}
            image={lookUrl("hpf")}
            objectId={cell.object}
            label={`${cell.class_name.toLowerCase()} cell`}
            state={cell.object === current ? "current" : value ? "done" : "to-check"}
            decision={value ?? "open"}
            ringed={confirming && !value}
            dimmed={confirming && Boolean(value)}
            ai={{
              calls: [{ label: cell.class_name.toLowerCase(), probability: cell.score }],
              typer: reviewTyper,
              wording: claimHidden ? "hidden" : "words",
            }}
            outline={<CellOutline object={cell.object} white={claimHidden} />}
            onClick={() => onPick(cell.object)}
            {...cropStyle(cell.object)}
          />
        );
      })}
    </CellsPanel>
  );
}
