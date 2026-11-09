import { useGetMySettingLayers } from "@parfocal/api-client";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { okData } from "../screens/placeholder.tsx";
import { destinations } from "../shell/destinations.ts";
import { useGoTo } from "../shell/router-link.tsx";
import { helpTopics } from "./help-topics.ts";
import { closeHelp, startTour, useHelpOpen } from "./tour-state.ts";
import { progressOf, resumeIndex, tourLength } from "./tour-steps.ts";

export function HelpDialog() {
  const open = useHelpOpen();
  const goTo = useGoTo();
  const progress = progressOf(okData(useGetMySettingLayers().data)?.personal.tour_progress);
  const resuming = resumeIndex(progress) > 0;
  return (
    <SmallModal
      open={open}
      onOpenChange={(next) => {
        if (!next) closeHelp();
      }}
      title="Help"
      subtitle="Short answers, the shortcut sheet and the tour."
      primaryLabel={resuming ? "Resume the tour" : "Take the tour"}
      onPrimary={() => startTour(resumeIndex(progress))}
      cancelLabel="Close"
      onCancel={closeHelp}
      hint={`The tour has ${tourLength} steps and you can stop at any time.`}
      secondaryAction={
        <button
          type="button"
          className="text-body-sm text-accent underline"
          onClick={() => {
            closeHelp();
            void goTo(destinations.settings("shortcuts"));
          }}
        >
          Open the shortcut sheet
        </button>
      }
    >
      <dl className="grid gap-2 text-body-sm">
        {helpTopics.map((topic) => (
          <div key={topic.title}>
            <dt className="font-medium text-ink">{topic.title}</dt>
            <dd className="text-ink-2">{topic.text}</dd>
          </div>
        ))}
      </dl>
    </SmallModal>
  );
}
