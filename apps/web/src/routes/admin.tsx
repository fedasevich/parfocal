import { createFileRoute } from "@tanstack/react-router";
import { AdminScreen } from "../screens/admin/admin-screen.tsx";
import { sectionOf } from "../screens/onboarding/scenes.ts";
import { adminSearch } from "../search/route-searches.ts";

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
      request={search.request}
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
