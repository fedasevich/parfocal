import { useLingui } from "@lingui/react/macro";
import { useListMySlides } from "@parfocal/api-client";
import { Loader } from "@parfocal/ui/components/loader";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { okData } from "../screens/placeholder.tsx";
import { NotFoundPage } from "../shell/issue-pages.tsx";
import { slidePath } from "../shell/slide-link.ts";

export function SlideAddressCheck({
  projectId,
  slideId,
  search,
  children,
}: {
  projectId: string;
  slideId: string;
  search: Record<string, unknown>;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const inProject = useListMySlides({ project_id: projectId });
  const page = okData(inProject.data);
  const missing =
    page !== undefined &&
    page.next_cursor === null &&
    !page.slides.some((slide) => slide.id === slideId);
  const everywhere = useListMySlides({ limit: 200 }, { query: { enabled: missing } });
  const elsewhere = okData(everywhere.data)?.slides.find((slide) => slide.id === slideId);
  const ownProject = elsewhere?.project.id;
  useEffect(() => {
    if (ownProject === undefined || ownProject === projectId) return;
    void navigate({
      to: slidePath,
      params: { projectId: ownProject, slideId },
      search: search as never,
      replace: true,
    });
  }, [ownProject, projectId, slideId, search, navigate]);
  if (!missing) return children;
  if (everywhere.isPending) return <Loader label={t`Opening the slide`} size="page" />;
  if (elsewhere !== undefined)
    return ownProject === projectId ? (
      children
    ) : (
      <Loader label={t`Opening the slide`} size="page" />
    );
  if (everywhere.isError || okData(everywhere.data)?.next_cursor !== null) return children;
  return <NotFoundPage />;
}
