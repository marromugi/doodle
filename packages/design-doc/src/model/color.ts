import * as z from "zod";

const NAMED_COLORS = new Set(
  `transparent aliceblue antiquewhite aqua aquamarine azure beige bisque black
  blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate
  coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod
  darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange
  darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray
  darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey
  dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite
  gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo
  ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue
  lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey
  lightpink lightsalmon lightseagreen lightskyblue lightslategray
  lightslategrey lightsteelblue lightyellow lime limegreen linen magenta
  maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen
  mediumslateblue mediumspringgreen mediumturquoise mediumvioletred
  midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive
  olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise
  palevioletred papayawhip peachpuff peru pink plum powderblue purple
  rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen
  seashell sienna silver skyblue slateblue slategray slategrey snow
  springgreen steelblue tan teal thistle tomato turquoise violet wheat white
  whitesmoke yellow yellowgreen`.split(/\s+/),
);

const COLOR_SPACES = new Set([
  "srgb",
  "srgb-linear",
  "display-p3",
  "a98-rgb",
  "prophoto-rgb",
  "rec2020",
  "xyz",
  "xyz-d50",
  "xyz-d65",
]);

const ANGLE_UNITS = new Set(["deg", "grad", "rad", "turn"]);

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const NUMBER = /[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const HEX_DIGIT = /[0-9a-fA-F]/;

/** CSS keywords fold ASCII letters only. */
const fold = (text: string): string =>
  text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

const isCssWhitespace = (char: string | undefined): boolean =>
  char === " " ||
  char === "\t" ||
  char === "\n" ||
  char === "\r" ||
  char === "\f";

const isNameStart = (char: string | undefined): boolean =>
  char !== undefined && (/[A-Za-z_]/.test(char) || char.charCodeAt(0) >= 0x80);

const isNameChar = (char: string | undefined): boolean =>
  isNameStart(char) || (char !== undefined && /[0-9-]/.test(char));

const startsEscape = (text: string, at: number): boolean =>
  text[at] === "\\" &&
  text[at + 1] !== undefined &&
  !/[\n\r\f]/.test(text[at + 1]!);

/** Reads one escape after the backslash at `at`. */
const readEscape = (
  text: string,
  at: number,
): { char: string; next: number } => {
  let next = at + 1;
  if (HEX_DIGIT.test(text[next]!)) {
    let digits = "";
    while (digits.length < 6 && HEX_DIGIT.test(text[next] ?? "")) {
      digits += text[next];
      next += 1;
    }
    if (text[next] === "\r" && text[next + 1] === "\n") next += 2;
    else if (isCssWhitespace(text[next])) next += 1;
    const code = parseInt(digits, 16);
    const valid =
      code !== 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
    return { char: String.fromCodePoint(valid ? code : 0xfffd), next };
  }
  const point = text.codePointAt(next)!;
  return {
    char: String.fromCodePoint(point),
    next: next + (point > 0xffff ? 2 : 1),
  };
};

const startsIdent = (text: string, at: number): boolean => {
  const first = text[at];
  if (first === "-") {
    const second = text[at + 1];
    return second === "-" || isNameStart(second) || startsEscape(text, at + 1);
  }
  return isNameStart(first) || startsEscape(text, at);
};

const readIdent = (
  text: string,
  at: number,
): { text: string; next: number } => {
  let out = "";
  let next = at;
  for (;;) {
    if (isNameChar(text[next])) {
      out += text[next];
      next += 1;
    } else if (startsEscape(text, next)) {
      const escape = readEscape(text, next);
      out += escape.char;
      next = escape.next;
    } else {
      return { text: out, next };
    }
  }
};

type Item =
  | { kind: "number" | "percentage" | "angle" | "none" | "comma" | "slash" }
  | { kind: "ident"; text: string };

/** Reads the arguments after "(" up to the closing ")"; comments and whitespace separate nothing. */
const readArguments = (
  text: string,
  from: number,
): { items: Item[]; close: number } | null => {
  const items: Item[] = [];
  let at = from;
  while (at < text.length) {
    const char = text[at]!;
    if (isCssWhitespace(char)) {
      at += 1;
    } else if (char === "/" && text[at + 1] === "*") {
      const end = text.indexOf("*/", at + 2);
      if (end < 0) return null;
      at = end + 2;
    } else if (char === ")") {
      return { items, close: at };
    } else if (char === ",") {
      items.push({ kind: "comma" });
      at += 1;
    } else if (char === "/") {
      items.push({ kind: "slash" });
      at += 1;
    } else {
      NUMBER.lastIndex = at;
      if (NUMBER.test(text)) {
        at = NUMBER.lastIndex;
        if (text[at] === "%") {
          items.push({ kind: "percentage" });
          at += 1;
        } else if (startsIdent(text, at)) {
          const unit = readIdent(text, at);
          if (!ANGLE_UNITS.has(fold(unit.text))) return null;
          items.push({ kind: "angle" });
          at = unit.next;
        } else {
          items.push({ kind: "number" });
        }
      } else if (startsIdent(text, at)) {
        const ident = readIdent(text, at);
        if (text[ident.next] === "(") return null;
        const folded = fold(ident.text);
        items.push(
          folded === "none"
            ? { kind: "none" }
            : { kind: "ident", text: folded },
        );
        at = ident.next;
      } else {
        return null;
      }
    }
  }
  return null;
};

type Kind = Item["kind"];
type Argument = readonly Kind[];

const CHANNEL: Argument = ["number", "percentage", "none"];
const HUE: Argument = ["number", "angle", "none"];
const ALPHA: Argument = ["number", "percentage"];

/** The three colour channels of each function in the space-separated syntax. */
const CHANNELS: Record<string, [Argument, Argument, Argument]> = {
  rgb: [CHANNEL, CHANNEL, CHANNEL],
  rgba: [CHANNEL, CHANNEL, CHANNEL],
  hsl: [HUE, CHANNEL, CHANNEL],
  hsla: [HUE, CHANNEL, CHANNEL],
  hwb: [HUE, CHANNEL, CHANNEL],
  lab: [CHANNEL, CHANNEL, CHANNEL],
  lch: [CHANNEL, CHANNEL, HUE],
  oklab: [CHANNEL, CHANNEL, CHANNEL],
  oklch: [CHANNEL, CHANNEL, HUE],
};

const fits = (item: Item | undefined, allowed: Argument): boolean =>
  item !== undefined && allowed.includes(item.kind);

const isLegacy = (name: string, items: Item[]): boolean => {
  if (items.length !== 5 && items.length !== 7) return false;
  const commasRight = items.every(
    (item, index) => (item.kind === "comma") === (index % 2 === 1),
  );
  if (!commasRight) return false;
  const values = items.filter((item) => item.kind !== "comma");
  const [first, second, third, alpha] = values;
  if (alpha !== undefined && !fits(alpha, ALPHA)) return false;
  if (name === "rgb" || name === "rgba") {
    const kind = first!.kind;
    return (
      (kind === "number" || kind === "percentage") &&
      second!.kind === kind &&
      third!.kind === kind
    );
  }
  if (name === "hsl" || name === "hsla") {
    return (
      fits(first, ["number", "angle"]) &&
      second!.kind === "percentage" &&
      third!.kind === "percentage"
    );
  }
  return false;
};

const isModern = (name: string, items: Item[]): boolean => {
  const slash = items.findIndex((item) => item.kind === "slash");
  const channels = slash < 0 ? items : items.slice(0, slash);
  if (slash >= 0) {
    const alpha = items.slice(slash + 1);
    if (alpha.length !== 1 || !fits(alpha[0], [...ALPHA, "none"])) return false;
  }
  if (channels.some((item) => item.kind === "comma" || item.kind === "slash")) {
    return false;
  }
  if (name === "color") {
    const [space, ...rest] = channels;
    return (
      space?.kind === "ident" &&
      COLOR_SPACES.has(space.text) &&
      rest.length === 3 &&
      rest.every((item) => fits(item, CHANNEL))
    );
  }
  const expected = CHANNELS[name];
  return (
    expected !== undefined &&
    channels.length === 3 &&
    channels.every((item, index) => fits(item, expected[index]!))
  );
};

export const isColor = (value: string): boolean => {
  if (HEX.test(value)) return true;
  if (!startsIdent(value, 0)) return false;
  const ident = readIdent(value, 0);
  if (ident.next === value.length) return NAMED_COLORS.has(fold(ident.text));
  if (value[ident.next] !== "(") return false;
  const args = readArguments(value, ident.next + 1);
  if (args === null || args.close !== value.length - 1) return false;
  const name = fold(ident.text);
  return args.items.some((item) => item.kind === "comma")
    ? isLegacy(name, args.items)
    : isModern(name, args.items);
};

export const Color = z.string().refine(isColor, { message: "not a colour" });
export type Color = z.infer<typeof Color>;
