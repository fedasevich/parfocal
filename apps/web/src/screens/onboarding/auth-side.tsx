import { AuthLayout, AuthPitchSide, type AuthWorkspace } from "@parfocal/ui/components/auth";
import type { ReactNode } from "react";

export const SIGN_IN_ART_URL = "/models/signin-slide-v1.webp";

export const pitchWorkspace: AuthWorkspace = { name: "", logo: "", colour: "transparent" };

export function PitchLayout({ children }: { children: ReactNode }) {
  return (
    <AuthLayout side={<AuthPitchSide workspace={pitchWorkspace} imageUrl={SIGN_IN_ART_URL} />}>
      {children}
    </AuthLayout>
  );
}
