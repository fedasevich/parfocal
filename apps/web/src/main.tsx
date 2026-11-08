import "@parfocal/ui/globals.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { selectWebClients } from "./clients.ts";
import { readBuildConfig } from "./config.ts";
import { installDebugHandle, provideDebug } from "./debug-handle.ts";
import { benchmarkDebug } from "./lab/pan-sweep.ts";
import { createQueryClient } from "./query-client.ts";
import { createAppRouter } from "./router.ts";
import { ErrorToasts, showErrorToast } from "./shell/error-toasts.tsx";
import { installNameMask } from "./shell/hide-names.ts";
import { installTheme } from "./shell/theme.ts";
import { UndoToasts } from "./shell/undo-toasts.tsx";
import { viewTransitions } from "./shell/view-transitions.ts";
import { connectAppAnalytics } from "./telemetry/app-events.ts";
import { watchSensitiveData } from "./telemetry/sensitive-data.ts";

const config = readBuildConfig();

installTheme();

installDebugHandle(window, config.appEnv);
provideDebug(benchmarkDebug(window));

export const clients = selectWebClients(config, {});
connectAppAnalytics(clients.analytics);

const queryClient = createQueryClient(showErrorToast);
installNameMask(queryClient);
watchSensitiveData(queryClient, clients.sensitive);

const prototypeFrame = import.meta.env.DEV
  ? (await import("./flow-map/prototype-bar.tsx")).PrototypeFrame
  : undefined;

const router = createAppRouter(prototypeFrame);
viewTransitions.listen();

if (import.meta.env.DEV && config.fakeApi !== "off") {
  const { startFakeApi } = await import("./fake-api/start.tsx");
  await startFakeApi(config.fakeApi, queryClient, router);
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
      <RouterProvider router={router} />
      <ErrorToasts />
      <UndoToasts />
    </QueryClientProvider>
  </StrictMode>,
);
