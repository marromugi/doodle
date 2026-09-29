import { z } from "@hono/zod-openapi";

import { FILE_NAME_MAX_LENGTH } from "../catalog/settings";

const NAME_RULE = `The name must be 1 to ${FILE_NAME_MAX_LENGTH} characters and not only whitespace.`;

/** The name of a file or a page. Length is counted in code points; duplicates are allowed. */
export const NameSchema = z
  .string()
  .refine(
    (name) => {
      const length = [...name].length;
      return (
        length >= 1 && length <= FILE_NAME_MAX_LENGTH && name.trim() !== ""
      );
    },
    { message: NAME_RULE },
  )
  .openapi({
    minLength: 1,
    maxLength: FILE_NAME_MAX_LENGTH,
    description: `${NAME_RULE} Length is counted in Unicode code points.`,
  });

export const invalidName = (): {
  ok: false;
  code: "invalid_name";
  message: string;
} => ({ ok: false, code: "invalid_name", message: NAME_RULE });
