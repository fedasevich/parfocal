import { Trans, useLingui } from "@lingui/react/macro";
import { useGetPlatformStatus } from "@parfocal/api-client";
import { Banner } from "@parfocal/ui/components/banner";
import { okData } from "../screens/placeholder.tsx";
import { maintenanceCheckMs, maintenanceNotice } from "./maintenance-notice.ts";

export function MaintenanceBanner() {
  const { i18n } = useLingui();
  const { data } = useGetPlatformStatus({
    query: { refetchInterval: maintenanceCheckMs, staleTime: maintenanceCheckMs },
  });
  const notice = maintenanceNotice(okData(data));
  if (notice === null) return null;
  const until =
    notice.expectedEndAt === null
      ? null
      : new Intl.DateTimeFormat(i18n.locale, { hour: "2-digit", minute: "2-digit" }).format(
          notice.expectedEndAt,
        );
  return (
    <Banner tone="warn" data-testid="maintenance-banner">
      <Trans>
        <b>Maintenance.</b> Changes are paused and you can still read everything.
      </Trans>{" "}
      {notice.message}
      {until === null ? null : (
        <>
          {" "}
          <Trans>Expected back at {until}.</Trans>
        </>
      )}
    </Banner>
  );
}
