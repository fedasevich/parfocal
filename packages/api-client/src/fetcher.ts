import { networkError, toApiError } from "./problem.ts";

export type ApiResponse<Data> = {
  data: Data;
  status: number;
  headers: Headers;
};

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw networkError();
  }
  if (!response.ok) throw await toApiError(response);
  const data: unknown = response.status === 204 ? undefined : await response.json();
  const result: ApiResponse<unknown> = { data, status: response.status, headers: response.headers };
  return result as T;
}
