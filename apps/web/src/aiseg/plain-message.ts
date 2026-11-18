import { EngineNotReadyError, SamStartError } from "@parfocal/viewer-engine";

export const modelNotStartedText = "The model is not running yet";
export const modelNotLoadedText = "The model could not load its files";

export function canStartModel(message: string | null): boolean {
  return message === modelNotStartedText || message === modelNotLoadedText;
}

export function plainFailure(error: unknown, fallback: string): string {
  if (error instanceof SamStartError) return modelNotLoadedText;
  return error instanceof EngineNotReadyError ? modelNotStartedText : fallback;
}
