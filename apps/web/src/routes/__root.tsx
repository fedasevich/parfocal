import { createRootRoute, Outlet, useMatches } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { FeedbackHost } from "../feedback/feedback-host.tsx";
import { KeyBindingsProvider } from "../keys/keycap-bindings.tsx";
import { LabKey } from "../lab/lab-key.tsx";
import { SessionLock } from "../session/session-lock.tsx";
import { CommandPalette } from "../shell/command-palette.tsx";
import { useAppliedDensity } from "../shell/density.ts";
import { GlobalShell } from "../shell/global-shell.tsx";
import { NotFoundPage, ServerErrorPage } from "../shell/issue-pages.tsx";
import { useAppliedLengthUnits } from "../shell/length-units-setting.ts";
import { useAppliedOutlineMode } from "../shell/outline-mode-setting.ts";
import { overlaySearch } from "../shell/overlays.ts";
import { useReadingReport } from "../shell/reading-report.ts";
import { SettingsKey } from "../shell/settings-key.tsx";
import { inGlobalShell } from "../shell/shell-routes.ts";
import { ShortcutsKey } from "../shell/shortcuts-key.tsx";
import { useAnalyticsConsentSync } from "../telemetry/consent-sync.ts";

const TourHost = lazy(async () => ({
  default: (await import("../help/tour-host.tsx")).TourHost,
}));

export const Route = createRootRoute({
  validateSearch: overlaySearch,
  component: Root,
  notFoundComponent: NotFoundPage,
  errorComponent: ServerErrorPage,
});

function Root() {
  const inShell = useMatches({
    select: (matches) => matches.some(inGlobalShell),
  });
  useAppliedDensity();
  useAppliedLengthUnits();
  useAppliedOutlineMode();
  useReadingReport();
  useAnalyticsConsentSync();
  return (
    <SessionLock>
      <KeyBindingsProvider>
        {inShell ? (
          <GlobalShell>
            <Outlet />
          </GlobalShell>
        ) : (
          <Outlet />
        )}
        <CommandPalette />
        <ShortcutsKey />
        <SettingsKey />
        <LabKey />
        <FeedbackHost />
        <Suspense fallback={null}>
          <TourHost />
        </Suspense>
      </KeyBindingsProvider>
    </SessionLock>
  );
}
