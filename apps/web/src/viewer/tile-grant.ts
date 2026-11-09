import { getTileAccess } from "@parfocal/api-client";

export type Grant = {
  readonly token: string;
  readonly lifetimeSeconds: number;
  readonly basePath: string;
  readonly original: string;
  readonly format: string | null;
};

export async function grantFor(slideId: string, previous: string | null): Promise<Grant> {
  const response = await getTileAccess(
    slideId,
    previous === null ? undefined : { headers: { "Previous-Tile-Token": previous } },
  );
  if (response.status !== 200) throw new Error(`tile-access answered ${response.status}`);
  const access = response.data;
  return {
    token: access.token,
    lifetimeSeconds: access.lifetime_seconds,
    basePath: access.base_path,
    original: access.original,
    format: access.format,
  };
}
