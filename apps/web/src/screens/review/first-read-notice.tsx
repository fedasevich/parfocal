import { Icon } from "@parfocal/ui/components/icon";
import { Link } from "@tanstack/react-router";

export function FirstReadNotice({ taskId, slideId }: { taskId: string; slideId: string }) {
  return (
    <div className="grid justify-items-start gap-2" data-testid="first-read-notice">
      <Icon name="eye-off" size="lg" className="text-fg-dim" />
      <h2 className="m-0 text-title-sm font-semibold">The AI stays hidden until your first read</h2>
      <p className="m-0 text-body-sm leading-[1.45] text-fg-dim">
        This task asks for your own read of the slide before the AI result appears. Record it in
        guided review.
      </p>
      <Link
        to="/tasks/$taskId/guided"
        params={{ taskId }}
        search={{ slide: slideId }}
        className="text-body-sm font-semibold text-accent underline"
        data-testid="first-read-link"
      >
        Record my first read
      </Link>
    </div>
  );
}
