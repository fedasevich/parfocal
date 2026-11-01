import { useGetMe } from "@parfocal/api-client";
import type { DecisionSplit } from "@parfocal/ui/components/progress-meter";
import { type ReviewMode, ReviewTopBar } from "@parfocal/ui/components/review-top-bar";
import { useNavigate } from "@tanstack/react-router";
import { AccountMenu } from "../../shell/account-menu.tsx";
import { destinations } from "../../shell/destinations.ts";
import { personOf } from "../../shell/global-shell.tsx";
import { useRouterLink } from "../../shell/router-link.tsx";
import { okData } from "../placeholder.tsx";
import { lookUrl } from "../thumbnails.ts";
import type { ReviewSession } from "./review-data.ts";

export type SlideCounts = DecisionSplit & { total: number; decided: number };

const minutesPerSlide = 20;

export function timeLeft(session: ReviewSession) {
  const neighbours = session.neighbours;
  if (neighbours === undefined) return "";
  const minutes = (neighbours.total - neighbours.position) * minutesPerSlide;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `about ${rest} min left`;
  return `about ${hours} h${rest ? ` ${rest} min` : ""} left`;
}

type ReviewTopProps = {
  mode: ReviewMode;
  session: ReviewSession;
  counts: SlideCounts | undefined;
  nothingToDecide?: boolean;
  submitReason?: string | undefined;
  onSubmit?: () => void;
  progressSub?: string | undefined;
  primaryLabel?: string | undefined;
  primaryTitle?: string | undefined;
};

export function ReviewTop({
  mode,
  session,
  counts,
  nothingToDecide = false,
  submitReason,
  onSubmit,
  progressSub,
  primaryLabel,
  primaryTitle,
}: ReviewTopProps) {
  const me = okData(useGetMe().data);
  const renderLink = useRouterLink();
  const navigate = useNavigate();
  const position = session.neighbours
    ? `Slide ${session.neighbours.position} of ${session.neighbours.total}`
    : "";
  return (
    <ReviewTopBar
      mode={mode}
      taskName={session.taskName}
      taskSub={session.taskSub}
      slideName={session.slideName}
      slideThumb={lookUrl("overview")}
      progress={nothingToDecide ? undefined : counts}
      progressTitle={position}
      progressSub={progressSub ?? (nothingToDecide ? "Nothing to decide" : timeLeft(session))}
      {...(primaryLabel ? { primaryLabel } : {})}
      primaryDisabledReason={submitReason}
      primaryTitle={
        primaryTitle ??
        (mode === "full"
          ? "Open the Slide done card in the Opinion tab"
          : "Open the Slide done card")
      }
      onPrimary={onSubmit}
      backHref={destinations.myWork()}
      renderLink={renderLink}
      onModeChange={(next) => {
        const projectId = session.task?.project_id;
        if (next === "full" && projectId) {
          void navigate({
            to: "/projects/$projectId/slides/$slideId",
            params: { projectId, slideId: session.slideId },
            search: { task: session.taskId },
          });
        }
        if (next === "guided") {
          void navigate({
            to: "/tasks/$taskId/guided",
            params: { taskId: session.taskId },
            search: { slide: session.slideId },
          });
        }
      }}
      accountSlot={<AccountMenu me={me} person={personOf(me)} />}
    />
  );
}
