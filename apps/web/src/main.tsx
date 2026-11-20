import "@parfocal/ui/globals.css";
import { getGetMeQueryOptions, setDraftsAnswered } from "@parfocal/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { selectWebClients } from "./clients.ts";
import { readBuildConfig } from "./config.ts";
import { installDebugHandle, provideDebug } from "./debug-handle.ts";
import { AppI18n } from "./i18n/app-i18n.tsx";
import { createQueryClient } from "./query-client.ts";
import { createAppRouter } from "./router.ts";
import { locksAt } from "./session/lock-rules.ts";
import { signedOutRedirect } from "./session/sign-in-redirect.ts";
import { installDisplayDefaults } from "./shell/display-defaults.ts";
import { ErrorToasts, showErrorToast } from "./shell/error-toasts.tsx";
import { installNameMask } from "./shell/hide-names.ts";
import { installMotion } from "./shell/motion.ts";
import { reloadOnStaleChunks } from "./shell/stale-chunks.ts";
import { installTheme } from "./shell/theme.ts";
import { UndoToasts } from "./shell/undo-toasts.tsx";
import { viewTransitions } from "./shell/view-transitions.ts";
import { connectAppAnalytics } from "./telemetry/app-events.ts";
import { connectFrameReporter } from "./telemetry/frame-monitor.ts";
import { watchSensitiveData } from "./telemetry/sensitive-data.ts";

const config = readBuildConfig();
setDraftsAnswered(config.fakeApi !== "off");

reloadOnStaleChunks(window);
installTheme();
installMotion();
installDisplayDefaults();

if (installDebugHandle(window, config.appEnv)) {
  void import("./lab/pan-sweep.ts").then(({ benchmarkDebug }) =>
    provideDebug(benchmarkDebug(window)),
  );
}

export const clients = selectWebClients(config, {});
connectAppAnalytics(clients.analytics);
connectFrameReporter(clients.frames);

const queryClient = createQueryClient(showErrorToast, signedOutRedirect(window));
installNameMask(queryClient);
watchSensitiveData(queryClient, clients.sensitive);

const devTools = import.meta.env.PARFOCAL_PUBLIC_DEV_TOOLS === "on";

const prototypeFrame = devTools
  ? (await import("./flow-map/prototype-bar.tsx")).PrototypeFrame
  : undefined;

const router = createAppRouter(prototypeFrame);
viewTransitions.listen();

if (devTools && config.fakeApi !== "off") {
  const { startFakeApi } = await import("./fake-api/start.tsx");
  await startFakeApi(config.fakeApi, queryClient, router);
}

if (locksAt(window.location.pathname)) {
  queryClient.query(getGetMeQueryOptions()).catch(() => {});
}

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root element");

const report = (error: unknown) => clients.errors.capture(error);

createRoot(container, {
  onUncaughtError: report,
  onCaughtError: report,
  onRecoverableError: report,
}).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppI18n>
        <RouterProvider router={router} />
        <ErrorToasts />
        <UndoToasts />
      </AppI18n>
    </QueryClientProvider>
  </StrictMode>,
);
