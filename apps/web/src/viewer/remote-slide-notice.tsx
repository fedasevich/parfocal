import { Trans, useLingui } from "@lingui/react/macro";
import { useCopyRemoteSlide } from "@parfocal/api-client";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { CategoryTag } from "@parfocal/ui/components/tag";
import { useState } from "react";
import { type CopyOutcome, copyAction, copyOutcome } from "./remote-copy.ts";
import type { SlideStorageNote } from "./tile-grant.ts";

export function RemoteSlideTag({ note }: { note: SlideStorageNote | null }) {
  const { t } = useLingui();
  if (note?.storage !== "remote") return null;
  return (
    <CategoryTag
      icon="link"
      tone="info"
      data-testid="remote-tag"
      title={t`Read in place from a connected source. Nothing is copied.`}
    >
      <Trans>remote</Trans>
    </CategoryTag>
  );
}

export function RemoteSlideOffline({ note }: { note: SlideStorageNote | null }) {
  if (note?.storage !== "remote" || !note.offline) return null;
  return (
    <Banner tone="warn" icon="link" data-testid="remote-offline">
      <Trans>
        <b>The source of this slide is not answering.</b> The slide opens from the 7-day tile cache.
        Places never viewed stay empty until the source is back.
      </Trans>
    </Banner>
  );
}

export function CopyIntoParfocal({
  slideId,
  note,
  canUpload,
}: {
  slideId: string;
  note: SlideStorageNote | null;
  canUpload: boolean;
}) {
  const { t } = useLingui();
  const copy = useCopyRemoteSlide();
  const [outcome, setOutcome] = useState<{ slideId: string; value: CopyOutcome } | null>(null);
  const action = copyAction(note, canUpload);
  if (action === "hidden") return null;
  const shown = outcome?.slideId === slideId ? outcome.value : null;
  const messages: Record<CopyOutcome, string> = {
    queued: t`Copying. The slide keeps its ID, reviews and annotations.`,
    "already-copied": t`This slide is already stored in Parfocal.`,
    "not-ready": t`The slide is still being inspected at its source.`,
    failed: t`The copy could not be started. Try again.`,
  };
  return (
    <span className="flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        data-testid="copy-into-parfocal"
        disabled={action === "offline" || copy.isPending || shown === "queued"}
        title={
          action === "offline"
            ? t`The source is not answering, so the slide cannot be copied now.`
            : t`Copy the file once into Parfocal storage.`
        }
        onClick={() =>
          copy.mutate(
            { slideId },
            {
              onSuccess: (answer) => setOutcome({ slideId, value: copyOutcome(answer) }),
              onError: () => setOutcome({ slideId, value: "failed" }),
            },
          )
        }
      >
        <Trans>Copy into Parfocal</Trans>
      </Button>
      {shown ? (
        <span role="status" data-testid="copy-outcome" className="text-body-sm text-fg-muted">
          {messages[shown]}
        </span>
      ) : null}
    </span>
  );
}
