export const packageName = "@parfocal/api-client";

export { type ApiResponse, apiFetch } from "./fetcher.ts";
export * from "./generated/api.ts";
export {
  ApiError,
  type ErrorKind,
  type FieldError,
  isProblem,
  kindForStatus,
  networkError,
  type Problem,
  problemMediaType,
  toApiError,
} from "./problem.ts";
