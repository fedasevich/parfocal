import { AuthLayout, AuthPitchSide, type AuthWorkspace } from "@parfocal/ui/components/auth";
import type { ReactNode } from "react";

export const pitchWorkspace: AuthWorkspace = { name: "", logo: "", colour: "transparent" };

export function PitchLayout({ children }: { children: ReactNode }) {
  return <AuthLayout side={<AuthPitchSide workspace={pitchWorkspace} />}>{children}</AuthLayout>;
}
