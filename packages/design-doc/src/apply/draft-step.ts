import type { DraftDocument } from "../model/document";
import type { EditOperation } from "../model/operation";
import type { Component } from "../model/scope";
import { TokenKind, Typography, type Tokens } from "../model/tokens";
import type { Result } from "../roles";
import { has } from "../validate/prop-types";
import type { ApplyFailure } from "./failure";
import { conflictsOf, fail } from "./helpers";

type Step = Result<DraftDocument, ApplyFailure>;

const missing = (target: string, message: string) =>
  fail({ code: "target-missing", target, message });

const exists = (target: string, message: string) =>
  fail({ code: "target-exists", target, message });

const notApplicable = (message: string) =>
  fail({ code: "operation-not-applicable", message });

const splitToken = (
  token: string,
): { kind: TokenKind; name: string } | undefined => {
  const dot = token.indexOf(".");
  const kind = TokenKind.safeParse(token.slice(0, dot));
  return dot < 0 || !kind.success
    ? undefined
    : { kind: kind.data, name: token.slice(dot + 1) };
};

const withToken = (
  tokens: Tokens,
  kind: TokenKind,
  name: string,
  value: unknown,
): Tokens => {
  const { [name]: _old, ...rest } = tokens[kind] as Record<string, unknown>;
  const table = value === undefined ? rest : { ...rest, [name]: value };
  return { ...tokens, [kind]: table } as Tokens;
};

const valueFits = (kind: TokenKind, value: unknown): boolean => {
  if (kind === "color") return typeof value === "string";
  if (kind === "typography") return Typography.safeParse(value).success;
  return typeof value === "number";
};

const bump = (
  doc: DraftDocument,
  patch: Partial<DraftDocument>,
  history: Partial<{ tokens: string; components: string }>,
): Step => {
  const revision = doc.revision + 1;
  const tokens = { ...doc.history.tokens };
  const components = { ...doc.history.components };
  if (history.tokens !== undefined) tokens[history.tokens] = revision;
  if (history.components !== undefined)
    components[history.components] = revision;
  return {
    ok: true,
    value: {
      ...doc,
      ...patch,
      revision,
      history: { ...doc.history, tokens, components },
    },
  };
};

const tokenConflicts = (
  doc: DraftDocument,
  base: number,
  token: string,
): ApplyFailure[] =>
  conflictsOf(doc.revision, doc.history.tokens, base, [token], (t) => ({
    message: `token "${t}" changed after revision ${base}`,
  }));

const componentConflicts = (
  doc: DraftDocument,
  base: number,
  id: string,
): ApplyFailure[] =>
  conflictsOf(doc.revision, doc.history.components, base, [id], (c) => ({
    message: `component "${c}" changed after revision ${base}`,
  }));

const nameTaken = (
  doc: DraftDocument,
  name: string,
  exceptId: string,
): boolean =>
  Object.entries(doc.components).some(
    ([id, c]) => id !== exceptId && c.name === name,
  );

const withProps = (
  doc: DraftDocument,
  id: string,
  props: Component["props"],
): Record<string, Component> => ({
  ...doc.components,
  [id]: { ...doc.components[id]!, props },
});

export const draftStep = (doc: DraftDocument, op: EditOperation): Step => {
  switch (op.type) {
    case "add-token":
    case "change-token":
    case "remove-token": {
      const early = tokenConflicts(doc, op.base, op.token);
      if (early.length > 0) return { ok: false, reasons: early };
      const parts = splitToken(op.token);
      const present =
        parts !== undefined && has(doc.tokens[parts.kind], parts.name);
      if (op.type === "add-token") {
        if (!parts || !valueFits(parts.kind, op.value)) {
          return notApplicable(`"${op.token}" cannot take this value`);
        }
        if (present)
          return exists(op.token, `token "${op.token}" already exists`);
      } else if (!parts || !present) {
        return missing(op.token, `token "${op.token}" does not exist`);
      }
      if (op.type === "remove-token") {
        return bump(
          doc,
          {
            tokens: withToken(doc.tokens, parts!.kind, parts!.name, undefined),
          },
          { tokens: op.token },
        );
      }
      if (!valueFits(parts!.kind, op.value)) {
        return notApplicable(`"${op.token}" cannot take this value`);
      }
      return bump(
        doc,
        { tokens: withToken(doc.tokens, parts!.kind, parts!.name, op.value) },
        { tokens: op.token },
      );
    }
    case "add-component": {
      const early = componentConflicts(doc, op.base, op.id);
      if (early.length > 0) return { ok: false, reasons: early };
      if (has(doc.components, op.id)) {
        return exists(op.id, `component "${op.id}" already exists`);
      }
      if (nameTaken(doc, op.component.name, op.id)) {
        return fail({
          code: "component-name-taken",
          name: op.component.name,
          message: `component name "${op.component.name}" is taken`,
        });
      }
      return bump(
        doc,
        { components: { ...doc.components, [op.id]: op.component } },
        { components: op.id },
      );
    }
    case "remove-component": {
      const early = componentConflicts(doc, op.base, op.id);
      if (early.length > 0) return { ok: false, reasons: early };
      if (!has(doc.components, op.id)) {
        return missing(op.id, `component "${op.id}" does not exist`);
      }
      const { [op.id]: _gone, ...rest } = doc.components;
      return bump(doc, { components: rest }, { components: op.id });
    }
    case "rename-component": {
      const early = componentConflicts(doc, op.base, op.id);
      if (early.length > 0) return { ok: false, reasons: early };
      if (!has(doc.components, op.id)) {
        return missing(op.id, `component "${op.id}" does not exist`);
      }
      if (nameTaken(doc, op.to, op.id)) {
        return fail({
          code: "component-name-taken",
          name: op.to,
          message: `component name "${op.to}" is taken`,
        });
      }
      return bump(
        doc,
        {
          components: {
            ...doc.components,
            [op.id]: { ...doc.components[op.id]!, name: op.to },
          },
        },
        { components: op.id },
      );
    }
    case "add-prop":
    case "change-prop":
    case "remove-prop": {
      const early = componentConflicts(doc, op.base, op.component);
      if (early.length > 0) return { ok: false, reasons: early };
      if (!has(doc.components, op.component)) {
        return missing(
          op.component,
          `component "${op.component}" does not exist`,
        );
      }
      const props = doc.components[op.component]!.props;
      const present = has(props, op.name);
      if (op.type === "add-prop") {
        if (present) return exists(op.name, `prop "${op.name}" already exists`);
      } else if (!present) {
        return missing(op.name, `prop "${op.name}" does not exist`);
      }
      const { [op.name]: _old, ...rest } = props;
      const next =
        op.type === "remove-prop" ? rest : { ...rest, [op.name]: op.def };
      return bump(
        doc,
        { components: withProps(doc, op.component, next) },
        { components: op.component },
      );
    }
    default:
      return notApplicable(`"${op.type}" does not apply to a draft document`);
  }
};
