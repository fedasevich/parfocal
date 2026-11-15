import { useLingui } from "@lingui/react/macro";
import { defaultFakeView, fakeView, scenario } from "@parfocal/api-client/fake";
import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { AppI18n } from "../i18n/app-i18n.tsx";
import { shellStore } from "../shell/shell-store.ts";
import { type FakeScope, fakeBadgeLabel, subscribeToQueries } from "./badge-state.ts";

function personaNote(): string | null {
  const { viewer, firstWeek } = fakeView();
  if (viewer !== defaultFakeView.viewer) {
    const person = scenario.people[viewer];
    return `viewing as ${shellStore.getState().initialsOnly ? person.key : person.name}`;
  }
  return firstWeek ? "in the first week" : null;
}

function FakeDataBadge({ scope, queryClient }: { scope: FakeScope; queryClient: QueryClient }) {
  const { t } = useLingui();

  const cache = queryClient.getQueryCache();
  const label = useSyncExternalStore(
    (onChange) => subscribeToQueries(cache, onChange),
    () => fakeBadgeLabel(scope, cache.getAll()),
  );
  const persona = useSyncExternalStore(
    (onChange) => subscribeToQueries(cache, onChange),
    personaNote,
  );
  if (label === null) return null;
  return (
    <output
      data-testid="fake-data-badge"
      title={t`This screen is served by MSW in the dev build. Staging and production never show it.`}
      className="pointer-events-none fixed right-3 bottom-3 z-50 rounded-full border border-warn bg-chrome px-3 py-1 font-medium text-warn text-caption shadow"
    >
      {label}
      {persona ? <span data-testid="fake-persona"> · {persona}</span> : null}
    </output>
  );
}

export function mountFakeDataBadge(scope: FakeScope, queryClient: QueryClient): void {
  const host = document.createElement("div");
  host.dataset["fakeApi"] = scope;
  document.body.append(host);
  createRoot(host).render(
    <AppI18n>
      <FakeDataBadge scope={scope} queryClient={queryClient} />
    </AppI18n>,
  );
}
