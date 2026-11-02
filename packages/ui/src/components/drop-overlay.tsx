import { Icon } from "@parfocal/ui/components/icon";

type DropOverlayProps = {
  projectCode: string;
  slides: number;
  results: number;
  onDrop: () => void;
};

function DropOverlay({ projectCode, slides, results, onDrop }: DropOverlayProps) {
  return (
    <button
      type="button"
      data-testid="drop-overlay"
      onClick={onDrop}
      className="absolute inset-3 z-25 grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-accent bg-[color-mix(in_srgb,var(--page)_70%,transparent)]"
    >
      <span className="grid max-w-110 justify-items-center gap-2 rounded-[14px] border border-line bg-chrome px-8.5 py-6.5 text-center shadow-pop">
        <Icon name="upload" size="lg" className="text-accent" />
        <b className="text-[18px] text-fg">Drop to upload into {projectCode}</b>
        <span className="text-body-sm text-fg-dim">
          {slides} slides and {results} result files. The upload page opens with them, so you can
          check the match before anything starts.
        </span>
      </span>
    </button>
  );
}

export { DropOverlay, type DropOverlayProps };
