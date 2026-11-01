import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { type FakeScope, fakeBadgeLabel, subscribeToQueries } from "./badge-state.ts";

function FakeDataBadge({ scope, queryClient }: { scope: FakeScope; queryClient: QueryClient }) {
  const cache = queryClient.getQueryCache();
  const label = useSyncExternalStore(
    (onChange) => subscribeToQueries(cache, onChange),
    () => fakeBadgeLabel(scope, cache.getAll()),
  );
  if (label === null) return null;
  return (
    <output
      data-testid="fake-data-badge"
      title="This screen is served by MSW in the dev build. Staging and production never show it."
      className="fixed right-3 bottom-3 z-50 rounded-full border border-warn bg-chrome px-3 py-1 font-medium text-warn text-xs shadow"
    >
      {label}
    </output>
  );
}

export function mountFakeDataBadge(scope: FakeScope, queryClient: QueryClient): void {
  const host = document.createElement("div");
  host.dataset["fakeApi"] = scope;
  document.body.append(host);
  createRoot(host).render(<FakeDataBadge scope={scope} queryClient={queryClient} />);
}
