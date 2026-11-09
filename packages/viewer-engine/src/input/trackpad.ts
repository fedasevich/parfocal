import { type CameraProfile, defaultCameraProfile } from "../camera/profile.ts";

export interface ClickInput {
  readonly button: number;
  readonly ctrlKey: boolean;
  readonly pointerType: string;
}

export const secondaryButton = 2;

export function isTwoFingerClick(input: ClickInput): boolean {
  if (input.pointerType !== "mouse") return false;
  return input.button === secondaryButton || (input.button === 0 && input.ctrlKey);
}

export function safariPinchOctaves(
  previousScale: number,
  scale: number,
  profile: CameraProfile = defaultCameraProfile,
): number {
  if (!(previousScale > 0) || !(scale > 0)) return 0;
  const octaves = Math.log2(scale / previousScale);
  const cap = Math.max(0, profile.maxOctavesPerEvent);
  return Math.max(-cap, Math.min(cap, octaves));
}
