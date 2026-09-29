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

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION = /^([a-z]+)\(([^()]*)\)$/is;
const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?`;
const IS_NUMBER = new RegExp(`^${NUMBER}$`, "i");
const IS_PERCENTAGE = new RegExp(`^${NUMBER}%$`, "i");
const IS_ANGLE = new RegExp(`^${NUMBER}(?:deg|grad|rad|turn)$`, "i");
const WHITESPACE = /[ \t\n\r\f]+/;

type Argument = (token: string) => boolean;

const isNone: Argument = (token) => token.toLowerCase() === "none";
const isNumber: Argument = (token) => IS_NUMBER.test(token);
const isPercentage: Argument = (token) => IS_PERCENTAGE.test(token);
const isHue: Argument = (token) => isNumber(token) || IS_ANGLE.test(token);
const either =
  (...checks: Argument[]): Argument =>
  (token) =>
    checks.some((check) => check(token));

const numberOrPercentage = either(isNumber, isPercentage);
const modernChannel = either(isNumber, isPercentage, isNone);
const modernHue = either(isHue, isNone);
const modernAlpha = modernChannel;

/** Argument checks for the three channels of each function, in order. */
const CHANNELS: Record<string, [Argument, Argument, Argument]> = {
  rgb: [modernChannel, modernChannel, modernChannel],
  rgba: [modernChannel, modernChannel, modernChannel],
  hsl: [modernHue, modernChannel, modernChannel],
  hsla: [modernHue, modernChannel, modernChannel],
  hwb: [modernHue, modernChannel, modernChannel],
  lab: [modernChannel, modernChannel, modernChannel],
  lch: [modernChannel, modernChannel, modernHue],
  oklab: [modernChannel, modernChannel, modernChannel],
  oklch: [modernChannel, modernChannel, modernHue],
};

const matches = (tokens: string[], checks: Argument[]): boolean =>
  tokens.length === checks.length &&
  tokens.every((token, index) => checks[index]!(token));

const isLegacy = (name: string, tokens: string[]): boolean => {
  if (tokens.length !== 3 && tokens.length !== 4) return false;
  const [first, second, third, alpha] = tokens as [
    string,
    string,
    string,
    string | undefined,
  ];
  if (alpha !== undefined && !numberOrPercentage(alpha)) return false;
  if (name === "rgb" || name === "rgba") {
    return [first, second, third].every(
      (token) =>
        (isNumber(token) && isNumber(first)) ||
        (isPercentage(token) && isPercentage(first)),
    );
  }
  if (name === "hsl" || name === "hsla") {
    return isHue(first) && isPercentage(second) && isPercentage(third);
  }
  return false;
};

const isModern = (name: string, body: string): boolean => {
  const parts = body.split("/");
  if (parts.length > 2) return false;
  const [channels, alpha] = parts as [string, string | undefined];
  if (alpha !== undefined && !modernAlpha(alpha.trim())) return false;
  const tokens = channels.trim().split(WHITESPACE);
  if (name === "color") {
    const [space, ...rest] = tokens;
    return (
      space !== undefined &&
      COLOR_SPACES.has(space.toLowerCase()) &&
      matches(rest, [modernChannel, modernChannel, modernChannel])
    );
  }
  const checks = CHANNELS[name];
  return checks !== undefined && matches(tokens, checks);
};

export const isColor = (value: string): boolean => {
  if (HEX.test(value)) return true;
  if (NAMED_COLORS.has(value.toLowerCase())) return true;
  const call = FUNCTION.exec(value);
  if (call === null) return false;
  const name = call[1]!.toLowerCase();
  const body = call[2]!;
  if (!body.includes(",")) return isModern(name, body);
  const tokens = body.split(",").map((token) => token.trim());
  return isLegacy(name, tokens);
};

export const Color = z.string().refine(isColor, { message: "not a colour" });
export type Color = z.infer<typeof Color>;
