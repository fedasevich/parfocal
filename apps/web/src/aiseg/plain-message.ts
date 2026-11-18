import { EngineNotReadyError } from "@parfocal/viewer-engine";

export const modelNotStartedText = "The model is not running yet";

export function plainFailure(error: unknown, fallback: string): string {
  return error instanceof EngineNotReadyError ? modelNotStartedText : fallback;
}
