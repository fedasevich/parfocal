import { Trans, useLingui } from "@lingui/react/macro";
import type { ProjectClass } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { useMemo, useState } from "react";
import { clearAll } from "../annotations/clear.ts";
import type { AnnotationDocument } from "../annotations/document.ts";
import { MeasurementList } from "../measure/measurement-list.tsx";
import { DockCard } from "./inspector-slots.tsx";

export function StageMeasurementCard({
  document: doc,
  micronsPerPixel,
  classes,
  onRemove,
  onApply,
}: {
  document: AnnotationDocument;
  micronsPerPixel: number | null;
  classes: readonly ProjectClass[];
  onRemove: ((id: number) => void) | undefined;
  onApply: (next: AnnotationDocument, label: string) => void;
}) {
  const { t } = useLingui();
  const [asking, setAsking] = useState(false);
  const classNames = useMemo(() => new Map(classes.map((item) => [item.id, item.name])), [classes]);
  const count = doc.shapes.size;
  return (
    <DockCard section="objects" order={4}>
      <MeasurementList
        document={doc}
        micronsPerPixel={micronsPerPixel}
        classNames={classNames}
        {...(onRemove === undefined ? {} : { onRemove })}
      />
      {count > 0 ? (
        <Button size="sm" data-testid="clear-annotations" onClick={() => setAsking(true)}>
          <Trans>Clear all</Trans>
        </Button>
      ) : null}
      {asking && count > 0 ? (
        <SmallModal
          open
          onOpenChange={(next) => {
            if (!next) setAsking(false);
          }}
          title={t`Delete all ${count} shapes on this slide?`}
          subtitle={t`Regions, rulers and markers go. Undo brings them back.`}
          primaryLabel={t`Delete all shapes`}
          onPrimary={() => {
            setAsking(false);
            onApply(clearAll(doc).document, t`Clear all`);
          }}
        />
      ) : null}
    </DockCard>
  );
}
