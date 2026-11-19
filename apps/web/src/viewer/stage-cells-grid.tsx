import type { ReviewObject } from "@parfocal/api-client";
import { useEffect, useMemo, useState } from "react";
import { actionOf } from "../keys/actions.ts";
import { useBindings } from "../keys/personal-keys.ts";
import { type Fired, isTyping } from "../keys/registry.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { inLayer } from "../screens/review/answer-keys.ts";
import { type Direction, stripStep } from "../screens/review/cell-jump.ts";
import { CellsGrid, stripColumns } from "../screens/review/cells-grid.tsx";
import { rawFor } from "../screens/review/decision-mapping.ts";
import { answersOf, showsClaim } from "../screens/review/decision-style.ts";
import type { ReviewSession } from "../screens/review/review-data.ts";
import { baseAnswers } from "../screens/review/review-state.ts";
import { cellsInTissueOrder } from "./stage-geometry.ts";
import { holdCellArrows } from "./viewer-keys.ts";

type Saves = { save: (object: string, raw: string, value: "agree") => void };

const stripActions = ["dnear", "drest"];
const directions = new Set<string>(["left", "right", "up", "down"]);

export function StageCellsGrid({
  engine,
  session,
  saves,
  slideId,
  current,
  readOnly = false,
  onPick,
  onStep,
  onClose,
}: {
  engine: object;
  session: ReviewSession;
  saves: Saves;
  slideId: string;
  current: string | null;
  readOnly?: boolean;
  onPick: (object: string) => void;
  onStep: (object: string) => void;
  onClose: () => void;
}) {
  const [folded, setFolded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const cells = useMemo(() => cellsInTissueOrder<ReviewObject>(session.objects), [session.objects]);
  const answers = baseAnswers(
    session.objects,
    session.decisions,
    session.style,
    "review",
    {},
    session.classes,
  );
  const answer = (object: string) => answers.get(object);
  const currentCell = cells.find((cell) => cell.object === current) ?? cells[0];
  const agreeRest = () => {
    if (readOnly) return;
    for (const cell of cells) {
      if (!answer(cell.object))
        saves.save(cell.object, rawFor(session.style, "agree", cell), "agree");
    }
    setConfirming(false);
  };
  const order = cells.map((cell) => cell.object);
  const picked = current !== null && order.includes(current) ? current : undefined;
  const firstOpen = cells.find((cell) => !answer(cell.object))?.object;
  const canAgreeRest = !readOnly && showsClaim(session.style) && firstOpen !== undefined;
  const stepping = !folded && !confirming;
  useEffect(() => (stepping ? holdCellArrows(engine) : undefined), [engine, stepping]);
  const bindings = useBindings(["review"], stripActions);
  useHotkeys(bindings, (fired: Fired) => {
    if (fired.phase !== "press" || inLayer()) return;
    const { id, suffix } = actionOf(fired.action);
    if (id === "drest") {
      if (canAgreeRest && !folded) setConfirming(true);
      return;
    }
    if (!stepping || !directions.has(suffix)) return;
    const next =
      picked === undefined
        ? (firstOpen ?? order[0])
        : stripStep(order, picked, suffix as Direction, stripColumns);
    if (next !== undefined && next !== picked) onStep(next);
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target) || inLayer()) return;
      if (event.key === "Escape") {
        if (confirming) setConfirming(false);
        else onClose();
      } else if (event.key === "Enter" && confirming) {
        event.preventDefault();
        agreeRest();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div
      data-testid="stage-cells-grid"
      className="absolute bottom-18 left-1/2 z-10 w-fit max-w-[calc(100%-2rem)] -translate-x-1/2"
    >
      <CellsGrid
        slideId={slideId}
        cells={cells}
        current={current ?? undefined}
        answer={answer}
        answerKeys={
          readOnly
            ? []
            : answersOf(session.style, session.classes, currentCell).map((item) => item.key)
        }
        claimHidden={!showsClaim(session.style)}
        readOnly={readOnly}
        folded={folded}
        confirming={confirming}
        onPick={onPick}
        onAgreeRest={() => setConfirming(true)}
        onApplyRest={agreeRest}
        onCancelRest={() => setConfirming(false)}
        onFoldChange={setFolded}
        onClose={onClose}
      />
    </div>
  );
}
