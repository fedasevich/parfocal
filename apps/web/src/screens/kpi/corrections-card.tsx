import { useLingui } from "@lingui/react/macro";
import { useGetAiCorrections } from "@parfocal/api-client";
import { okData } from "../placeholder.tsx";

const monthLabel = (month: string) =>
  new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(month),
  );

export function CorrectionsCard() {
  const { t } = useLingui();
  const months = okData(useGetAiCorrections().data)?.months ?? [];
  const worst = Math.max(1, ...months.map((item) => item.per_hundred));
  return (
    <section className="grid gap-2" data-testid="corrections-card">
      <h2 className="font-semibold text-fg">{t`Corrections per hundred nuclei`}</h2>
      <p className="text-body-sm text-fg-dim">
        {t`How many AI nuclei reviewers retyped or deleted for every hundred they checked, by month.`}
      </p>
      {months.length === 0 ? (
        <p className="text-body text-fg-dim" data-testid="corrections-empty">
          {t`No AI nuclei have been reviewed yet.`}
        </p>
      ) : (
        <ul className="grid gap-1 text-body">
          {months.map((item) => (
            <li
              key={item.month}
              className="grid grid-cols-[6rem_1fr_5rem] items-center gap-3 border-t border-line py-1"
              data-testid={`corrections-${item.month.slice(0, 7)}`}
            >
              <span className="text-fg">{monthLabel(item.month)}</span>
              <span
                className="h-2 rounded-sm bg-accent"
                style={{ width: `${(item.per_hundred / worst) * 100}%` }}
                role="img"
                aria-label={t`${item.corrections} corrections in ${item.nuclei_reviewed} nuclei`}
              />
              <span className="text-right font-mono" data-testid="corrections-value">
                {item.per_hundred.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
