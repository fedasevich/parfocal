import { Trans } from "@lingui/react/macro";
import { isDraftNotAvailable } from "@parfocal/api-client";
import { Banner } from "@parfocal/ui/components/banner";

export function NotAvailableYet({ what }: { what: string }) {
  return (
    <main className="px-8 pt-5.5 pl-7">
      <Banner tone="info" inline>
        <Trans>{what} is not available yet. This part of Parfocal is still being built.</Trans>
      </Banner>
    </main>
  );
}

export const notAvailable = (query: { error: unknown }): boolean =>
  isDraftNotAvailable(query.error);
