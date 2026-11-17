import { z } from "zod";

export function lenientSearch<Shape extends z.ZodRawShape>(shape: Shape) {
  const schema = z.object(shape);
  const keys = Object.keys(shape);
  const usable = (input: unknown): unknown => {
    if (typeof input !== "object" || input === null) return {};
    const given = input as Record<string, unknown>;
    const kept: Record<string, unknown> = { ...given };
    for (const key of keys) {
      const field = shape[key] as z.ZodType | undefined;
      if (field !== undefined && key in given && !field.safeParse(given[key]).success) {
        delete kept[key];
      }
    }
    return kept;
  };
  const standard = schema["~standard"];
  return {
    shape,
    read: (input: unknown): z.output<typeof schema> => schema.parse(usable(input)),
    "~standard": {
      ...standard,
      validate: (input: unknown) => standard.validate(usable(input)),
    } as typeof standard,
  };
}
