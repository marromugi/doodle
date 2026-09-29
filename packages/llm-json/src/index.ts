import {
  Operation,
  type DecodeFailure,
  type Document,
  type LlmRepresentation,
  type Result,
} from "@doodle/design-doc";

const decodeOperations = (text: string): Result<Operation[], DecodeFailure> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reasons: [{ code: "unreadable", message }] };
  }

  const result = Operation.array().safeParse(parsed);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    reasons: result.error.issues.map((issue) => ({
      code: "invalid-shape",
      message: issue.message,
      path: issue.path.map((key) =>
        typeof key === "symbol" ? String(key) : key,
      ),
    })),
  };
};

export const jsonRepresentation: LlmRepresentation = {
  encode: (doc: Document) => JSON.stringify(doc, null, 2),
  decodeOperations,
};
