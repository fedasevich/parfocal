import { AuthLayout, AuthPitchSide, type AuthWorkspace } from "@parfocal/ui/components/auth";
import type { ReactNode } from "react";

export const slideImage = "/mock-assets/mid-10x.jpg";

const pitchIds = [
  { id: "T1", text: "tumor region · 0.97", x: 80, y: 130 },
  { id: "T1·C145", text: "tumor cell · 0.91", x: 290, y: 205 },
  { id: "Z1", text: "14 unsure cells", x: 150, y: 285 },
  { id: "R2⁺", text: "ROI by a reviewer", x: 320, y: 360 },
];

export const pitchWorkspace: AuthWorkspace = { name: "", logo: "", colour: "transparent" };

export function PitchLayout({ children }: { children: ReactNode }) {
  return (
    <AuthLayout
      side={<AuthPitchSide workspace={pitchWorkspace} imageUrl={slideImage} ids={pitchIds} />}
    >
      {children}
    </AuthLayout>
  );
}
