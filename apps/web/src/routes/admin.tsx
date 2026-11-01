import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AdminScreen } from "../screens/admin/admin-screen.tsx";
import {
  adminModals,
  adminSections,
  onboardingScenes,
  sectionOf,
} from "../screens/onboarding/scenes.ts";

const adminSearch = z.object({
  section: z.enum(adminSections).optional(),
  scene: z.enum(onboardingScenes.admin).optional(),
  modal: z.enum(adminModals).optional(),
});

export const Route = createFileRoute("/admin")({
  validateSearch: adminSearch,
  component: Admin,
});

function Admin() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AdminScreen
      section={sectionOf(search.section, search.scene)}
      scene={search.scene}
      modal={search.modal}
      change={(next) =>
        void navigate({
          search: (previous) => {
            const merged = { ...previous, ...next };
            return {
              ...(merged.section ? { section: merged.section } : {}),
              ...(merged.scene ? { scene: merged.scene } : {}),
              ...(merged.modal ? { modal: merged.modal } : {}),
            };
          },
        })
      }
    />
  );
}
