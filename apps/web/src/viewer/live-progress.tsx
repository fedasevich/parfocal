import { useLingui } from "@lingui/react/macro";
import type { ReviewTaskDetail } from "@parfocal/api-client";
import { Icon } from "@parfocal/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@parfocal/ui/components/popover";
import { ReviewProgressPopover } from "@parfocal/ui/components/review-popovers";
import { ViewedRing } from "@parfocal/ui/components/viewed-ring";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { formatDue } from "../screens/format.ts";
import type { CaseLoad } from "./case-load.ts";
import {
  type LiveSlideList,
  liveDecisionSplit,
  stepLiveSlide,
  timeLeftText,
} from "./live-slides.ts";

const stepKeys = ["prevslide", "nextslide"];

export function useSlideStepKeys(
  list: LiveSlideList,
  slideId: string,
  onOpenSlide: (slideId: string) => void,
) {
  const bindings = useBindings(["viewer"], stepKeys);
  useHotkeys(bindings, ({ action }) => {
    const target = stepLiveSlide(list, slideId, action === "nextslide" ? 1 : -1);
    if (target !== undefined) onOpenSlide(target);
  });
}

type LiveProgressProps = {
  list: LiveSlideList;
  slideId: string;
  slideLabel: string;
  load: CaseLoad | null;
  task: ReviewTaskDetail | undefined;
  percent: number | null;
  objectTotal: number;
  onPeek: () => void;
  onOpenSlide: (slideId: string) => void;
};

export function LiveProgress({
  list,
  slideId,
  slideLabel,
  load,
  task,
  percent,
  objectTotal,
  onPeek,
  onOpenSlide,
}: LiveProgressProps) {
  const { t } = useLingui();
  const position = list.position;
  const heading = (
    <span className="grid leading-tight text-left">
      <b className="font-semibold">
        {position > 0 ? t`Slide ${position} of ${list.total}` : t`Slide`}
      </b>
      <small className="text-caption text-fg-dim">
        {percent === null ? t`Opening` : t`${percent}% of the tissue seen`}
      </small>
    </span>
  );
  const ring =
    percent === null ? null : (
      <ViewedRing data-testid="viewed-ring" percent={percent} size={34} onClick={onPeek} />
    );
  if (task === undefined || load?.task == null || position === 0) {
    return (
      <>
        {ring}
        {heading}
      </>
    );
  }
  const previous = stepLiveSlide(list, slideId, -1);
  const next = stepLiveSlide(list, slideId, 1);
  return (
    <>
      {ring}
      <Popover>
        <PopoverTrigger
          data-testid="progress-trigger"
          aria-haspopup="dialog"
          title={t`Progress on this slide and in the whole task`}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-ctl border-0 bg-transparent p-1 text-fg outline-none hover:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent aria-expanded:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)]"
        >
          {heading}
          <Icon name="down" className="text-fg-faint" />
        </PopoverTrigger>
        <PopoverContent align="start">
          <ReviewProgressPopover
            taskCode={load.task.code}
            taskName={load.task.name}
            taskSub={load.project.name}
            slideName={slideLabel}
            slide={liveDecisionSplit(load.decisions, objectTotal)}
            seenPercent={percent ?? undefined}
            onWholeSlide={onPeek}
            position={position}
            slideTotal={list.total}
            submittedCount={position - 1}
            dueText={task.due_on ? formatDue(task.due_on) : t`No due date`}
            timeLeft={timeLeftText(position, list.total)}
            onPrevious={previous === undefined ? undefined : () => onOpenSlide(previous)}
            onNext={next === undefined ? undefined : () => onOpenSlide(next)}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
