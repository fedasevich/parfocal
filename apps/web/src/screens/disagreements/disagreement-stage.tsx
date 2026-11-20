import { useListReviewObjects } from "@parfocal/api-client";
import { ObjectStage } from "../../viewer/object-stage.tsx";
import { okData } from "../placeholder.tsx";

type DisagreementStageProps = {
  taskId: string;
  slideId: string;
  object: string;
  claimHidden?: boolean;
  className?: string;
};

export function DisagreementStage({
  taskId,
  slideId,
  object,
  claimHidden = false,
  className = "",
}: DisagreementStageProps) {
  const found = okData(useListReviewObjects(taskId, slideId).data);
  return (
    <ObjectStage
      slideId={slideId}
      objectId={object}
      object={found?.objects.find((item) => item.object === object)}
      claimHidden={claimHidden}
      className={className}
    />
  );
}
