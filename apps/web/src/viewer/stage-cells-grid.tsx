import type { ReviewObject } from "@parfocal/api-client";
import { useMemo, useState } from "react";
import { CellsGrid } from "../screens/review/cells-grid.tsx";
import { rawFor } from "../screens/review/decision-mapping.ts";
import { answersOf, showsClaim } from "../screens/review/decision-style.ts";
import type { ReviewSession } from "../screens/review/review-data.ts";
import { baseAnswers } from "../screens/review/review-state.ts";

type Saves = { save: (object: string, raw: string, value: "agree") => void };

export function StageCellsGrid({
  session,
  saves,
  slideId,
  current,
  onPick,
  onClose,
}: {
  session: ReviewSession;
  saves: Saves;
  slideId: string;
  current: string | null;
  onPick: (object: string) => void;
  onClose: () => void;
}) {
  const [folded, setFolded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const cells = useMemo(
    () => session.objects.filter((item: ReviewObject) => item.kind === "cell"),
    [session.objects],
  );
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
    for (const cell of cells) {
      if (!answer(cell.object))
        saves.save(cell.object, rawFor(session.style, "agree", cell), "agree");
    }
    setConfirming(false);
  };
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
        answerKeys={answersOf(session.style, session.classes, currentCell).map((item) => item.key)}
        claimHidden={!showsClaim(session.style)}
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
