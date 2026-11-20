import { useLingui } from "@lingui/react/macro";
import {
  getGetProjectAccessQueryKey,
  useGetProjectAccess,
  useListTenantMembers,
  useRequestProjectAccess,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { NoAccessPage, NotFoundPage } from "../../shell/issue-pages.tsx";
import { okData } from "../placeholder.tsx";
import { useScreenToast } from "./screen-toast.tsx";

export function ProjectNoAccess({ projectId }: { projectId: string }) {
  const { t } = useLingui();
  const access = useGetProjectAccess(projectId);
  const members = okData(useListTenantMembers().data) ?? [];
  const ask = useRequestProjectAccess();
  const queryClient = useQueryClient();
  const toast = useScreenToast();
  const known = okData(access.data);
  if (access.isError) return <NotFoundPage />;
  if (known === undefined) return null;
  const ownerName =
    members.find((member) => member.user_id === known.owner_id)?.display_name ?? t`the owner`;
  return (
    <>
      <NoAccessPage
        ownerName={ownerName}
        asked={known.asked_at !== null}
        onAsk={() =>
          ask.mutate(
            { projectId },
            {
              onSuccess: () => {
                void queryClient.invalidateQueries({
                  queryKey: getGetProjectAccessQueryKey(projectId),
                });
                toast.show(t`Asked ${ownerName} to add you to this project`);
              },
            },
          )
        }
      />
      {toast.node}
    </>
  );
}
