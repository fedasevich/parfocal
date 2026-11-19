import { useLingui } from "@lingui/react/macro";
import type { ResultSet } from "@parfocal/api-client";
import { Icon } from "@parfocal/ui/components/icon";
import { IntoTopStack } from "@parfocal/ui/components/top-stack";
import { andJoin } from "../screens/format.ts";
import { resultSetStates } from "./result-set-state.ts";

export function ResultSetNotice({ resultSets }: { resultSets: readonly ResultSet[] }) {
  const { t } = useLingui();
  const states = resultSetStates(resultSets);
  if (states === null) return null;
  const { importing, failed } = states;
  return (
    <IntoTopStack order="wait">
      <div
        role="status"
        data-testid="result-set-notice"
        data-state={failed.length > 0 ? "failed" : "importing"}
        className="pointer-events-auto grid gap-1 rounded-md border border-line bg-chrome px-3 py-2 text-caption shadow-sm"
      >
        {failed.length > 0 ? (
          <span className="flex items-center gap-2">
            <Icon name="warn" className="text-warn" />
            {failed.length === 1
              ? t`The result set ${andJoin(failed)} did not import, so its objects are not shown.`
              : t`The result sets ${andJoin(failed)} did not import, so their objects are not shown.`}
          </span>
        ) : null}
        {importing.length > 0 ? (
          <span className="flex items-center gap-2">
            <Icon name="clock" className="text-fg-dim" />
            {importing.length === 1
              ? t`The result set ${andJoin(importing)} is still importing. Its objects show when it is ready.`
              : t`The result sets ${andJoin(importing)} are still importing. Their objects show when they are ready.`}
          </span>
        ) : null}
      </div>
    </IntoTopStack>
  );
}
