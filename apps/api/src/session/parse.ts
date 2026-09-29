import type { ZodType } from "zod";

/** Parses JSON text with a schema; null when it is not JSON or does not fit. */
export const parseJsonWith = <T>(
  schema: ZodType<T>,
  text: string,
): T | null => {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
