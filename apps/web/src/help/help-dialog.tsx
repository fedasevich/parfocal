import { Trans, useLingui } from "@lingui/react/macro";
import { useGetMySettingLayers } from "@parfocal/api-client";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { okData } from "../screens/placeholder.tsx";
import { destinations } from "../shell/destinations.ts";
import { useGoTo } from "../shell/router-link.tsx";
import { helpTopics } from "./help-topics.ts";
import { latestReleases } from "./release-notes-source.ts";
import { closeHelp, startTour, useHelpOpen } from "./tour-state.ts";
import { progressOf, resumeIndex, tourLength } from "./tour-steps.ts";

export function HelpDialog() {
  const { t } = useLingui();

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
      title={t`Help`}
      subtitle={t`Short answers, the shortcut sheet, the tour and what changed.`}
      primaryLabel={resuming ? t`Resume the tour` : t`Take the tour`}
      onPrimary={() => startTour(resumeIndex(progress))}
      cancelLabel={t`Close`}
      onCancel={closeHelp}
      hint={t`The tour has ${tourLength} steps and you can stop at any time.`}
      secondaryAction={
        <button
          type="button"
          className="text-body-sm text-accent underline"
          onClick={() => {
            closeHelp();
            void goTo(destinations.settings("shortcuts"));
          }}
        >
          <Trans>Open the shortcut sheet</Trans>
        </button>
      }
    >
      <dl className="grid gap-2 text-body-sm">
        {helpTopics.map((topic) => (
          <div key={topic.title}>
            <dt className="font-medium text-fg">{topic.title}</dt>
            <dd className="text-fg-dim">{topic.text}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="whats-new-heading" className="mt-4 grid gap-2 text-body-sm">
        <h3 id="whats-new-heading" className="font-medium text-fg">
          <Trans>What's new</Trans>
        </h3>
        {latestReleases.map((release) => (
          <div key={release.version}>
            <h4 className="text-fg-dim">
              {release.version} ({release.date})
            </h4>
            <ul className="list-disc pl-5 text-fg-dim">
              {release.notes.slice(0, 5).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </SmallModal>
  );
}
