import { useLingui } from "@lingui/react/macro";
import { TopProgress } from "@parfocal/ui/components/top-progress";
import { type Query, useIsFetching } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";

export const isFirstLoad = (query: Pick<Query, "state">): boolean =>
  query.state.data === undefined &&
  query.state.errorUpdateCount === 0 &&
  query.state.fetchStatus === "fetching";

export function useRoutePending(): boolean {
  return useRouterState({ select: (state) => state.status === "pending" });
}

export function RouteProgress() {
  const { t } = useLingui();
  const pending = useRoutePending();
  const firstLoads = useIsFetching({ predicate: isFirstLoad });
  return <TopProgress active={pending || firstLoads > 0} label={t`Loading`} />;
}
