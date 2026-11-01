import { Icon } from "@parfocal/ui/components/icon";
import { Person } from "@parfocal/ui/components/person";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { originStore, type Persona, useOrigin, usePeople } from "./hooks.ts";
import type { Origin } from "./origin.ts";
import { boxes, mapTitle, personaRoles } from "./review-flow.ts";
import { type ScenarioIds, targetFor } from "./targets.ts";
import {
  chapters,
  nextStep,
  previousStep,
  type StepRef,
  stepAt,
  stepRole,
  stepWho,
} from "./walkthrough.ts";

const barClass =
  "flex flex-wrap items-center gap-3 border-[1.5px] border-[#c026d3] border-dashed bg-[color-mix(in_srgb,#c026d3_7%,transparent)] px-2.5 py-2 text-body-sm text-fg-dim dark:border-[#e879f9] dark:bg-[color-mix(in_srgb,#e879f9_7%,transparent)]";

const barButtonClass =
  "inline-flex items-center gap-1.5 rounded-md border border-line bg-chrome py-1 pr-2.5 pl-2 font-semibold text-body-sm text-fg no-underline hover:border-line-strong";

function PersonaChip({ persona, role }: { persona: Persona; role: string | undefined }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-line bg-chrome py-0.5 pr-2.5 pl-0.5"
      data-testid="persona-chip"
    >
      <Person person={persona} size={20} />
      {role ? <span className="text-fg-dim">{role}</span> : null}
    </span>
  );
}

export function stepLink(ref: StepRef, ids: ScenarioIds) {
  const step = stepAt(ref);
  const chapter = chapters[ref.chapter];
  if (step === undefined || chapter === undefined) return null;
  return targetFor(step.screen, ids, {
    scene: step.scene,
    clinical: chapter.clinical ?? false,
    as: stepWho(ref),
  });
}

function WalkControl({
  to,
  ids,
  children,
}: {
  to: StepRef;
  ids: ScenarioIds;
  children: ReactNode;
}) {
  const link = stepLink(to, ids);
  if (link === null) return null;
  return (
    <Link
      {...link}
      className={barButtonClass}
      onClick={() => originStore.set({ kind: "walk", ...to, ids })}
    >
      {children}
    </Link>
  );
}

function MapOrigin({ box }: { box: string }) {
  const people = usePeople();
  const found = boxes.find((candidate) => candidate.id === box);
  const who = found?.who ?? "LM";
  return (
    <>
      <Link to="/flow-map" className={barButtonClass} onClick={() => originStore.set(null)}>
        <Icon name="back" size="sm" />
        Back to the map
      </Link>
      <span>Opened from {mapTitle}, as</span>
      <PersonaChip persona={people(who)} role={personaRoles[who]} />
      <span>· mock control, not in the app</span>
    </>
  );
}

function WalkOrigin({ at, ids }: { at: StepRef; ids: ScenarioIds }) {
  const people = usePeople();
  const chapter = chapters[at.chapter];
  const step = stepAt(at);
  const who = stepWho(at);
  if (chapter === undefined || step === undefined || who === undefined) return null;
  const previous = previousStep(at);
  const next = nextStep(at);
  return (
    <>
      <Link
        to="/flow-map/walkthrough/$chapter"
        params={{ chapter: String(at.chapter + 1) }}
        className={barButtonClass}
        onClick={() => originStore.set(null)}
      >
        <Icon name="back" size="sm" />
        Back to the chapter
      </Link>
      <span className="font-semibold text-fg" data-testid="walk-position">
        {at.chapter + 1} · {chapter.title}, step {at.step + 1} of {chapter.steps.length}
      </span>
      <PersonaChip persona={people(who)} role={stepRole(at, personaRoles)} />
      <p className="m-0 basis-full text-fg" data-testid="walk-text">
        {step.text}
      </p>
      {previous ? (
        <WalkControl to={previous} ids={ids}>
          Previous step
        </WalkControl>
      ) : null}
      {next ? (
        <WalkControl to={next} ids={ids}>
          Next step
          <Icon name="next" size="sm" />
        </WalkControl>
      ) : (
        <Link
          to="/flow-map/walkthrough"
          className={barButtonClass}
          onClick={() => originStore.set(null)}
        >
          Finish the walkthrough
        </Link>
      )}
      <span>· mock control, not in the app</span>
    </>
  );
}

function OriginBar({ origin }: { origin: Origin }) {
  return (
    <section aria-label="Prototype controls" className={barClass} data-testid="prototype-bar">
      {origin.kind === "map" ? (
        <MapOrigin box={origin.box} />
      ) : (
        <WalkOrigin at={{ chapter: origin.chapter, step: origin.step }} ids={origin.ids} />
      )}
    </section>
  );
}

const ownPages = ["/flow-map", "/prototype"];

export function PrototypeFrame({ children }: { children: ReactNode }) {
  const origin = useOrigin();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const onOwnPage = ownPages.some((page) => pathname === page || pathname.startsWith(`${page}/`));
  return (
    <>
      {origin !== null && !onOwnPage ? <OriginBar origin={origin} /> : null}
      {children}
    </>
  );
}
