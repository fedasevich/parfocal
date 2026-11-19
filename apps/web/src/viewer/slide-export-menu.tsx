import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@parfocal/ui/components/dropdown-menu";
import { Icon } from "@parfocal/ui/components/icon";
import { downloadSlideExport, slideExportChoices } from "../annotations/slide-export.ts";
import { showUndoToast } from "../shell/undo-toasts.tsx";

export function SlideExportMenu({ slideId, taskId }: { slideId: string; taskId: string }) {
  const { t } = useLingui();
  const choices = slideExportChoices();
  const save = async (choice: (typeof choices)[number]) => {
    const name = await downloadSlideExport(slideId, choice.format, taskId);
    showUndoToast({
      message: name === null ? t`The export could not be made` : t`Saved ${name}`,
    });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" data-testid="export-menu" aria-label={t`Export`} />}
      >
        <Icon name="download" />
        <Trans>Export</Trans>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {choices.map((choice) => (
          <DropdownMenuItem
            key={choice.format}
            data-testid={`export-${choice.format}`}
            className="items-start gap-2.5"
            onClick={() => void save(choice)}
          >
            <Icon name="download" className="mt-0.5" />
            <span className="grid">
              <span>{choice.label}</span>
              <small className="text-caption text-fg-dim">{choice.line}</small>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
