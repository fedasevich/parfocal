import { getHealth } from "@parfocal/api-client";
import { selectWebClients } from "./clients.ts";
import { readBuildConfig } from "./config.ts";

const config = readBuildConfig();

export const clients = selectWebClients(config, {});

if (import.meta.env.DEV && config.fakeApi !== "off") {
  const { startFakeApi } = await import("./fake-api/start.ts");
  await startFakeApi(config.fakeApi);
}

const status = document.createElement("output");
status.dataset["testid"] = "api-health";
document.body.append(status);
try {
  const health = await getHealth();
  status.textContent = `API ${health.data.status}`;
} catch (error) {
  clients.errors.capture(error);
  status.textContent = "API unreachable";
}
