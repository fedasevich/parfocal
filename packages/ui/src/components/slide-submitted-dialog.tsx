import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";

type NextSlideInfo = {
  thumbUrl: string;
  eyebrow: string;
  name: string;
  meta: string;
};

type SlideSubmittedDialogProps = {
  title: string;
  agreement?: string | undefined;
  next?: NextSlideInfo | undefined;
  primaryLabel: string;
  status: string;
  onPrimary: () => void;
  onDiffer: () => void;
  onBreak: () => void;
};

function SlideSubmittedDialog({
  title,
  agreement,
  next,
  primaryLabel,
  status,
  onPrimary,
  onDiffer,
  onBreak,
}: SlideSubmittedDialogProps) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="slide-submitted-title"
        className="grid w-140 max-w-[calc(100vw-32px)] gap-4 rounded-zone border border-line bg-chrome p-5.5 text-fg shadow-pop"
      >
        <div className="flex items-center gap-2.5">
          <Icon name="check" size="md" className="text-ok" />
          <b id="slide-submitted-title" className="text-title-sm font-semibold">
            {title}
          </b>
        </div>
        {agreement ? <p className="m-0 text-body text-fg-dim">{agreement}</p> : null}
        {next ? (
          <div className="grid grid-cols-[150px_1fr] items-center gap-3.5">
            <div
              aria-hidden="true"
              className="h-24 rounded-lg bg-cover bg-center"
              style={{ backgroundImage: `url(${next.thumbUrl})`, transform: "scaleX(-1)" }}
            />
            <div className="grid gap-1">
              <span className="text-caption font-semibold text-fg-dim">{next.eyebrow}</span>
              <b className="text-lead font-semibold" data-phi="">
                {next.name}
              </b>
              <span className="text-body-sm text-fg-dim">{next.meta}</span>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="lg" onClick={onPrimary}>
            {primaryLabel}
            <Keycap keys="↵" />
          </Button>
          <Button size="lg" onClick={onDiffer}>
            See where we differ
          </Button>
          <Button size="lg" onClick={onBreak}>
            Take a break
          </Button>
        </div>
        <span className="text-body-sm text-fg-dim">{status}</span>
      </section>
    </div>
  );
}

export { type NextSlideInfo, SlideSubmittedDialog, type SlideSubmittedDialogProps };
