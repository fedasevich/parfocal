import { createRootRoute, Outlet, useMatches } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { FeedbackHost } from "../feedback/feedback-host.tsx";
import { useAppliedLocale } from "../i18n/app-i18n.tsx";
import { KeyBindingsProvider } from "../keys/keycap-bindings.tsx";
import { LabKey } from "../lab/lab-key.tsx";
import { SessionLock } from "../session/session-lock.tsx";
import { useSignedInArea } from "../session/signed-in-area.ts";
import { CommandPalette } from "../shell/command-palette.tsx";
import { useAppliedDensity } from "../shell/density.ts";
import { GlobalShell } from "../shell/global-shell.tsx";
import { NotFoundPage, ServerErrorPage } from "../shell/issue-pages.tsx";
import { useAppliedLengthUnits } from "../shell/length-units-setting.ts";
import { useAppliedOutlineMode } from "../shell/outline-mode-setting.ts";
import { overlaySearch } from "../shell/overlays.ts";
import { useReadingReport } from "../shell/reading-report.ts";
import { RouteProgress } from "../shell/route-progress.tsx";
import { SettingsKey } from "../shell/settings-key.tsx";
import { SettingsOverlayHost } from "../shell/settings-overlay.tsx";
import { inGlobalShell } from "../shell/shell-routes.ts";
import { ShortcutsKey } from "../shell/shortcuts-key.tsx";
import { SurveyHost } from "../shell/survey-host.tsx";
import { insideTaskWindow } from "../study/study-window.ts";
import { useAnalyticsConsentSync } from "../telemetry/consent-sync.ts";
import { useRememberReturnPage } from "../viewer/use-return-page.ts";

const TourHost = lazy(() => import("../help/tour-host.tsx"));
const StudyGuardHost = lazy(() => import("../study/study-guard-host.tsx"));

export const Route = createRootRoute({
  validateSearch: overlaySearch,
  component: Root,
  notFoundComponent: NotFoundPage,
  errorComponent: ServerErrorPage,
});

function Root() {
  return (
    <SessionLock>
      <RootContent />
    </SessionLock>
  );
}

function RootContent() {
  const inShell = useMatches({
    select: (matches) => matches.some(inGlobalShell),
  });
  const signedIn = useSignedInArea();
  useAppliedDensity();
  useAppliedLocale();
  useAppliedLengthUnits();
  useAppliedOutlineMode();
  useReadingReport();
  useAnalyticsConsentSync();
  useRememberReturnPage();
  return (
    <KeyBindingsProvider>
      <RouteProgress />
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
      <SettingsOverlayHost />
      <LabKey />
      <FeedbackHost />
      {insideTaskWindow() ? (
        <Suspense fallback={null}>
          <StudyGuardHost />
        </Suspense>
      ) : null}
      <SurveyHost />
      {signedIn ? (
        <Suspense fallback={null}>
          <TourHost />
        </Suspense>
      ) : null}
    </KeyBindingsProvider>
  );
}
