import { useListReviewObjects } from "@parfocal/api-client";
import { ObjectStage, type StageOutline } from "../../viewer/object-stage.tsx";
import { okData } from "../placeholder.tsx";

type DisagreementStageProps = {
  taskId: string;
  slideId: string;
  object: string;
  claimHidden?: boolean;
  outlines?: readonly StageOutline[];
  className?: string;
};

const noOutlines: readonly StageOutline[] = [];

export function DisagreementStage({
  taskId,
  slideId,
  object,
  claimHidden = false,
  outlines = noOutlines,
  className = "",
}: DisagreementStageProps) {
  const found = okData(useListReviewObjects(taskId, slideId).data);
  return (
    <ObjectStage
      slideId={slideId}
      objectId={object}
      object={found?.objects.find((item) => item.object === object)}
      claimHidden={claimHidden}
      outlines={outlines}
      className={className}
    />
  );
}
