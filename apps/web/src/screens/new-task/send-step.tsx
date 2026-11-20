import { Trans, useLingui } from "@lingui/react/macro";
import { annotatePresets, checkSummary } from "@parfocal/ui/components/annotate-task";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Person } from "@parfocal/ui/components/person";
import { Textarea } from "@parfocal/ui/components/textarea";
import { Zone } from "@parfocal/ui/components/zone";
import type { ReactNode } from "react";
import {
  andJoin,
  decisionKinds,
  displaySummary,
  dueText,
  estimateText,
  hoursText,
  isAnnotate,
  mapping as mappingOf,
  mappingOk,
  numberList,
  reminderChoices,
  type StepKey,
  scopeKinds,
  scopePhrase,
  slidesWithResult,
  splitText,
  stepNames,
  summary,
} from "./model.ts";
import { FieldNote, GroupTitle } from "./parts.tsx";
import { type StepProps, TextLink } from "./steps.tsx";

type ReviewRow = [IconName, string, ReactNode];

export function SendStep({ draft, data, update, goTo }: StepProps) {
  const { t } = useLingui();

  const sum = summary(draft, data);
  const template = data.templates.find((candidate) => candidate.id === draft.templateId);
  const set = data.resultSets.find((candidate) => candidate.id === draft.resultSetId);
  const short = set?.short ?? "";
  const out = sum.all - sum.ns;
  const form = data.forms.find((candidate) => candidate.key === draft.form);
  const required =
    draft.form === "none"
      ? 0
      : draft.required.filter((key) => Number(key.slice(1)) <= (form?.questions.length ?? 0))
          .length;
  const kind = decisionKinds.find((candidate) => candidate.key === draft.decision.kind);
  const nameOf = (id: string) => data.people.find((person) => person.id === id)?.name ?? id;
  const people = sum.n ? (
    <span className="flex flex-wrap gap-x-4 gap-y-1.5">
      {draft.reviewers.map((id) => {
        const person = data.people.find((candidate) => candidate.id === id);
        return person ? (
          <Person
            key={id}
            size={20}
            person={{ initials: person.initials, name: person.name, color: person.colour }}
          />
        ) : null;
      })}
      {draft.invites.map((email) => (
        <span key={email} className="inline-flex items-center gap-1.5">
          <Icon name="mail" />
          {email}{" "}
          <small className="text-fg-dim">
            <Trans>invited</Trans>
          </small>
        </span>
      ))}
    </span>
  ) : null;
  const annotateGroups: [StepKey, ReviewRow[]][] = [
    [
      "kind",
      [
        ["flag", t`Kind`, t`Annotate`],
        [
          "target",
          t`Starting point`,
          annotatePresets.find((item) => item.key === draft.preset)?.title ?? "",
        ],
      ],
    ],
    [
      "slides",
      [
        [
          "slides",
          t`Slides`,
          sum.all
            ? t`${sum.all} slides, ${slidesWithResult(draft, data).length} with ${short}`
            : "",
        ],
        ["text", t`Task name`, draft.name.trim()],
      ],
    ],
    [
      "reviewers",
      [
        ["users", t`Experts`, people],
        ["list", t`Split`, splitText(sum, nameOf)],
      ],
    ],
    [
      "check",
      [
        ["target", t`Experts check`, checkSummary(draft.check)],
        ["sliders", t`Estimate`, estimateText(draft, data)],
      ],
    ],
    [
      "how",
      [
        ["eye", t`Blind first`, draft.blindFirst ? "On" : "Off"],
        ["calendar", "Due", draft.due ? dueText(draft.due) : ""],
        [
          "bell",
          t`Reminders`,
          reminderChoices.find((choice) => choice.key === draft.reminders)?.name ?? "",
        ],
      ],
    ],
  ];
  const reviewGroups: [StepKey, ReviewRow[]][] = [
    [
      "slides",
      [
        ["file", t`Template`, template ? `${template.name} ${template.version}` : ""],
        [
          "slides",
          t`Slides`,
          sum.ns ? t`${sum.ns} of ${sum.all} slides${out ? t`, ${out} without ${short}` : ""}` : "",
        ],
        ["layers", "AI result", set?.label ?? ""],
        ["text", t`Task name`, draft.name.trim()],
      ],
    ],
    [
      "reviewers",
      [
        ["users", t`Reviewers`, people],
        ["list", t`Split`, splitText(sum, nameOf)],
      ],
    ],
    [
      "check",
      [
        [
          "target",
          t`To check`,
          scopeKinds(draft).length
            ? `${scopePhrase(draft)}${sum.ns && sum.n ? t`. About ${hoursText(sum.hours)} each.` : ""}`
            : "",
        ],
        [
          "flag",
          t`Decision question`,
          `${kind?.name ?? ""}${draft.decision.kind === "certainty5" && mappingOk(draft.decision) ? t`, ${numberList(mappingOf(draft.decision).agree)} count as agree` : ""}`,
        ],
        [
          "comment",
          t`Opinion form`,
          draft.form === "none" ? t`None` : t`${form?.name ?? ""}, ${required} required`,
        ],
      ],
    ],
    [
      "how",
      [
        [
          "eye",
          t`Blinding`,
          `${draft.blind ? t`Blind until they submit` : t`Open`}${draft.hide ? t`, first read without the AI` : ""}`,
        ],
        ["monitor", t`Starts in`, draft.start === "guided" ? t`Guided review` : t`The full viewer`],
        ["sliders", t`Display`, displaySummary(draft)],
        ["calendar", "Due", draft.due ? dueText(draft.due) : ""],
        [
          "bell",
          t`Reminders`,
          reminderChoices.find((choice) => choice.key === draft.reminders)?.name ?? "",
        ],
      ],
    ],
  ];
  const groups = isAnnotate(draft) ? annotateGroups : reviewGroups;
  return (
    <>
      <Zone title={t`Check before you send`}>
        <div className="grid gap-6">
          {groups.map(([step, rows]) => (
            <div key={step} className="grid gap-2.5">
              <div className="flex items-center justify-between gap-3">
                <GroupTitle>{stepNames[step]}</GroupTitle>
                <TextLink onClick={() => goTo(step)}>
                  <Trans>Change</Trans>
                </TextLink>
              </div>
              <dl className="m-0 grid grid-cols-[168px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-body-sm leading-[1.45]">
                {rows.map(([icon, label, value]) => (
                  <div key={label} className="contents">
                    <dt className="flex items-start gap-2 text-fg-dim">
                      <Icon name={icon} className="mt-0.5" />
                      <span>{label}</span>
                    </dt>
                    <dd className="m-0 min-w-0 [overflow-wrap:anywhere] text-fg">
                      {value || (
                        <span className="text-fg-dim">
                          <Trans>Not set</Trans>
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </Zone>
      <Zone
        title={t`A note from you`}
        end={
          <span className="text-body-sm text-fg-dim">
            <Trans>optional</Trans>
          </span>
        }
      >
        <div className="grid gap-1.5">
          <Textarea
            aria-label={t`A note from you`}
            rows={3}
            maxLength={500}
            value={draft.note}
            placeholder={t`For example, the boundaries in A1 matter most this round.`}
            onChange={(event) => {
              const note = event.target.value;
              update((current) => ({ ...current, note }));
            }}
          />
          <FieldNote
            help={t`Added to the email the reviewers get.`}
            count={t`${draft.note.length} of 500`}
          />
        </div>
      </Zone>
    </>
  );
}

export function SentPanel({
  draft,
  data,
  code,
}: Pick<StepProps, "draft" | "data"> & { code: string }) {
  const { t } = useLingui();

  const people = draft.reviewers.flatMap((id) => {
    const person = data.people.find((candidate) => candidate.id === id);
    return person ? [person] : [];
  });
  return (
    <section className="grid justify-items-center gap-2.5 rounded-zone border border-surf-edge bg-surf-section px-10 py-15 text-center">
      <Icon name="check" size="xl" className="text-ok" />
      <h2 className="m-0 text-page-title font-semibold">
        <Trans>{code} is out</Trans>
      </h2>
      {people.length ? (
        <>
          <p className="m-0 mb-2 max-w-130 text-body-sm text-fg-dim">
            {people.length > 1
              ? t`${andJoin(people.map((person) => person.name))} were told by email. Each sees it at the top of My work, with one button to start.`
              : t`${andJoin(people.map((person) => person.name))} was told by email. They see it at the top of My work, with one button to start.`}
          </p>
          <div className="mt-2.5 flex justify-center gap-7">
            {people.map((person) => (
              <Person
                key={person.id}
                size={32}
                sub={t`Told just now`}
                person={{ initials: person.initials, name: person.name, color: person.colour }}
              />
            ))}
          </div>
        </>
      ) : null}
      {draft.invites.length ? (
        <p className="m-0 mt-2 flex items-center gap-2 text-body-sm text-fg-dim">
          <Icon name="mail" />
          <span>
            {andJoin(draft.invites)}{" "}
            {draft.invites.length > 1 ? t`were invited and get` : t`was invited and gets`}{" "}
            <Trans>the task when they join.</Trans>
          </span>
        </p>
      ) : null}
    </section>
  );
}
