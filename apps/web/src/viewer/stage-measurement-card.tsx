import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { clearAll, clearPrompt, needsClearConfirmation } from "../annotations/clear.ts";
import type { AnnotationDocument } from "../annotations/document.ts";
import { MeasurementList } from "../measure/measurement-list.tsx";
import { DockCard } from "./inspector-slots.tsx";

export function StageMeasurementCard({
  document: doc,
  micronsPerPixel,
  onRemove,
  onApply,
}: {
  document: AnnotationDocument;
  micronsPerPixel: number | null;
  onRemove: ((id: number) => void) | undefined;
  onApply: (next: AnnotationDocument, label: string) => void;
}) {
  const { t } = useLingui();
  return (
    <DockCard section="objects" order={4}>
      <MeasurementList
        document={doc}
        micronsPerPixel={micronsPerPixel}
        {...(onRemove === undefined ? {} : { onRemove })}
      />
      {doc.shapes.size > 0 ? (
        <Button
          size="sm"
          data-testid="clear-annotations"
          onClick={() => {
            const count = doc.shapes.size;
            if (needsClearConfirmation(count) && !window.confirm(clearPrompt(count))) return;
            onApply(clearAll(doc).document, t`Clear all`);
          }}
        >
          <Trans>Clear all</Trans>
        </Button>
      ) : null}
    </DockCard>
  );
}
