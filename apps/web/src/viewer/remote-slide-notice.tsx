import { Trans, useLingui } from "@lingui/react/macro";
import { Banner } from "@parfocal/ui/components/banner";
import { CategoryTag } from "@parfocal/ui/components/tag";
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
