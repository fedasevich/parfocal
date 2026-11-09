import { useGetMe } from "@parfocal/api-client";
import type { DecisionSplit } from "@parfocal/ui/components/progress-meter";
import { type ReviewMode, ReviewTopBar } from "@parfocal/ui/components/review-top-bar";
import { useNavigate } from "@tanstack/react-router";
import { ViewingNow } from "../../presence/viewing-now.tsx";
import { AccountMenu } from "../../shell/account-menu.tsx";
import { destinations } from "../../shell/destinations.ts";
import { personOf } from "../../shell/global-shell.tsx";
import { useRouterLink } from "../../shell/router-link.tsx";
import { okData } from "../placeholder.tsx";
import { lookUrl } from "../thumbnails.ts";
import { useInspectorLayout } from "./inspector-layout.ts";
import type { ReviewSession } from "./review-data.ts";
import { useReviewTopPopovers } from "./review-top-popovers.tsx";

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
  onWholeSlide?: (() => void) | undefined;
  object?: string | undefined;
  onHowItWorks?: (() => void) | undefined;
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
  onWholeSlide,
  object,
  onHowItWorks,
}: ReviewTopProps) {
  const popovers = useReviewTopPopovers({ mode, session, counts, onWholeSlide });
  const me = okData(useGetMe().data);
  const renderLink = useRouterLink();
  const navigate = useNavigate();
  const [layout, setLayout] = useInspectorLayout();
  const position = session.neighbours
    ? `Slide ${session.neighbours.position} of ${session.neighbours.total}`
    : "";
  return (
    <>
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
        slidesPopover={popovers.slidesPopover}
        progressPopover={popovers.progressPopover}
        moreItems={
          onHowItWorks
            ? [
                { icon: "help", label: "How guided review works", onSelect: onHowItWorks },
                ...(popovers.moreItems ?? []),
              ]
            : popovers.moreItems
        }
        slideSummary={popovers.slideSummary}
        showAnnotate={mode !== "adjudicate" && Boolean(session.task?.project_id)}
        {...(mode === "full" || mode === "annotate"
          ? {
              panelHidden: layout.hidden,
              onTogglePanel: () => setLayout((current) => ({ hidden: !current.hidden })),
            }
          : {})}
        backHref={destinations.myWork()}
        renderLink={renderLink}
        onModeChange={(next) => {
          const projectId = session.task?.project_id;
          if (next === "full" && projectId) {
            void navigate({
              to: "/projects/$projectId/slides/$slideId",
              params: { projectId, slideId: session.slideId },
              search: { task: session.taskId, ...(object ? { object } : {}) },
            });
          }
          if (next === "annotate" && projectId) {
            void navigate({
              to: "/projects/$projectId/slides/$slideId/annotate",
              params: { projectId, slideId: session.slideId },
              search: { task: session.taskId },
            });
          }
          if (next === "guided") {
            void navigate({
              to: "/tasks/$taskId/guided",
              params: { taskId: session.taskId },
              search: { slide: session.slideId, ...(object ? { object } : {}) },
            });
          }
        }}
        accountSlot={
          <>
            <ViewingNow slideId={session.slideId} />
            <AccountMenu me={me} person={personOf(me)} />
          </>
        }
      />
      {popovers.pinnedStrip}
    </>
  );
}
