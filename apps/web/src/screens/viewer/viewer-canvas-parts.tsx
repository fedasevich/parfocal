import { Trans, useLingui } from "@lingui/react/macro";
import type { SlideAiProgress } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { ObjectIdTag } from "@parfocal/ui/components/tag";
import type { ReactNode } from "react";
import { useFormat } from "../../format.ts";
import type { Answer } from "../review/review-state.ts";

export function readReach(progress: SlideAiProgress | undefined) {
  const regionsStep = progress?.steps.find((step) => step.key === "regions");
  return Math.min(1, Math.max(0, (regionsStep?.percent ?? 0) / 100));
}

export function RunningHeat({ reached }: { reached: number }) {
  return (
    <>
      <defs>
        <clipPath id="running-clip">
          <rect x={0} y={0} width={1400} height={1924 * reached} />
        </clipPath>
      </defs>
      <rect
        width={1400}
        height={1924}
        fill="var(--accent)"
        opacity={0.12}
        clipPath="url(#running-clip)"
      />
      <line
        data-testid="ai-reached"
        data-reached={reached}
        x1={0}
        x2={1400}
        y1={1924 * reached}
        y2={1924 * reached}
        stroke="var(--accent)"
        strokeWidth={2}
        strokeDasharray="8 6"
        vectorEffect="non-scaling-stroke"
      />
    </>
  );
}

export function TableObjectFacts({
  score,
  size,
  sets,
  answer,
  fullId,
  object,
  comments,
  onComments,
}: {
  object: string;
  score: number | null;
  size: number | null;
  sets: string[];
  answer: Answer | undefined;
  fullId: string;
  comments: number;
  onComments: () => void;
}) {
  const { t } = useLingui();

  const format = useFormat();
  const rows: [string, ReactNode][] = [
    ...(score === null
      ? []
      : [
          [
            t`Score`,
            <span key="s" className="font-mono">
              {format.number(score, { decimals: 2 })}
            </span>,
          ] as [string, ReactNode],
        ]),
    [t`Size`, size === null ? "" : `${format.size(size)} across`],
    [t`In sets`, sets.join(", ")],
    [
      t`Your decision`,
      answer
        ? `${answer.value === "unsure" ? t`Not sure` : `${answer.value.charAt(0).toUpperCase()}${answer.value.slice(1)}`}${answer.reasons[0] ? `, ${answer.reasons[0].toLowerCase()}` : ""}`
        : t`Open`,
    ],
    [t`Preset`, answer ? t`Task default` : t`None yet`],
    [
      "Full ID",
      <ObjectIdTag key="f" copyText={fullId}>
        {fullId}
      </ObjectIdTag>,
    ],
  ];
  return (
    <>
      <dl className="m-0 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-body-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-fg-dim">{label}</dt>
            <dd className="m-0">{value}</dd>
          </div>
        ))}
      </dl>
      <Button className="w-full" onClick={onComments}>
        <Icon name="comment" />
        <Trans>
          {comments} comments on {object}
        </Trans>
      </Button>
    </>
  );
}
