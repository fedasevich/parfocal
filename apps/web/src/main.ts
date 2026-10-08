import { selectWebClients } from "./clients.ts";
import { readBuildConfig } from "./config.ts";

export const clients = selectWebClients(readBuildConfig(), {});
