import { Trans, useLingui } from "@lingui/react/macro";
import { useHintsSeen } from "../hints/hints-seen.ts";
import { toolHintList } from "./tool-hint-list.ts";

const entries = toolHintList();

export function ToolHintsSection() {
  const { t } = useLingui();
  const { seen, showAgain } = useHintsSeen();
  return (
    <section
      aria-labelledby="tool-hints-heading"
      data-testid="help-tool-hints"
      className="grid gap-2 text-body-sm"
    >
      <h3 id="tool-hints-heading" className="font-medium text-fg">
        <Trans>Tool hints</Trans>
      </h3>
      <p className="text-fg-dim">
        <Trans>Each tool shows its hint once. Show one again to see it on the slide.</Trans>
      </p>
      <ul className="grid gap-1.5">
        {entries.map((entry) => {
          const closed = seen.has(entry.id);
          return (
            <li
              key={entry.id}
              data-testid="help-tool-hint"
              data-tool={entry.tool}
              className="flex items-start justify-between gap-3"
            >
              <span className="text-fg-dim">
                <span className="font-medium text-fg">{entry.label}</span>
                {" · "}
                {entry.lines.join(" · ")}
              </span>
              {closed ? (
                <button
                  type="button"
                  data-testid="help-show-hint"
                  aria-label={t`Show the ${entry.label} hint again`}
                  className="shrink-0 text-accent underline"
                  onClick={() => showAgain([entry.id])}
                >
                  <Trans>Show again</Trans>
                </button>
              ) : (
                <span className="shrink-0 text-fg-faint">
                  <Trans>Will show</Trans>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
