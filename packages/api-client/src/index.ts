export const packageName = "@parfocal/api-client";

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
