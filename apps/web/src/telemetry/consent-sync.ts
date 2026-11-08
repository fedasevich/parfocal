import { useEffect } from "react";
import { useSignedInArea } from "../session/signed-in-area.ts";
import { useResolvedSettings } from "../shell/resolved-settings.ts";
import { rememberAnalyticsChoices } from "./consent.ts";

export function useAnalyticsConsentSync(): void {
  const enabled = useSignedInArea();
  const settings = useResolvedSettings(enabled);
  const policy = settings?.analytics_policy;
  const optOut = settings?.analytics_opt_out;
  useEffect(() => {
    if (policy === undefined || optOut === undefined) return;
    rememberAnalyticsChoices({ analytics_policy: policy, analytics_opt_out: optOut });
  }, [policy, optOut]);
}
