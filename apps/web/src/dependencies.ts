import { packageName as apiClient } from "@parfocal/api-client";
import { packageName as tokens } from "@parfocal/tokens";
import { packageName as ui } from "@parfocal/ui";
import { packageName as viewerEngine } from "@parfocal/viewer-engine";

export const workspaceDependencies = [apiClient, tokens, ui, viewerEngine] as const;
