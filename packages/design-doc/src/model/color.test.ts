import { describe, expect, test } from "vitest";

import { isColor } from "./color";

const colors = (values: string[]) => values.filter((value) => isColor(value));
const notColors = (values: string[]) =>
  values.filter((value) => !isColor(value));

describe("isColor", () => {
  test("reads hex colours of 3, 4, 6 and 8 digits in either case", () => {
    const yes = ["#1a73e8", "#FF0000", "#fff", "#ffff", "#1a73e880"];
    expect(colors(yes)).toEqual(yes);
  });

  test("does not read hex colours of the wrong length or with non-hex digits", () => {
    const no = ["#12345", "#ggg"];
    expect(notColors(no)).toEqual(no);
  });

  test("reads named colours and transparent in either case", () => {
    const yes = ["red", "RebeccaPurple", "transparent"];
    expect(colors(yes)).toEqual(yes);
  });

  test("does not read a word that only starts like a named colour", () => {
    expect(isColor("reddish")).toBe(false);
  });

  test("reads rgb, rgba, hsl and hsla in comma syntax and in space syntax with a slash alpha", () => {
    const yes = [
      "rgb(255, 0, 0)",
      "rgba(255, 0, 0, 0.5)",
      "rgb(255 0 0 / 50%)",
      "hsl(120deg 50% 50%)",
      "hsla(120, 50%, 50%, 0.3)",
    ];
    expect(colors(yes)).toEqual(yes);
  });

  test("does not read rgb with two arguments", () => {
    expect(isColor("rgb(255, 0)")).toBe(false);
  });

  test("reads hwb, lab, lch, oklab, oklch, color() in a known space and none", () => {
    const yes = [
      "hwb(120 10% 20%)",
      "lab(50% 40 59.5)",
      "lch(52.2% 72.2 50)",
      "oklab(0.5 0.1 0.1)",
      "oklch(70% 0.1 200 / 0.5)",
      "color(display-p3 1 0 0)",
      "rgb(none 0 0)",
    ];
    expect(colors(yes)).toEqual(yes);
  });

  test("does not read unknown colour spaces, wrong argument counts, angles in rgb, mixed separators or none in comma syntax", () => {
    const no = [
      "color(unknown-space 1 0 0)",
      "lab(50%)",
      "oklch(1 2 3 4 5)",
      "rgb(10deg 0 0)",
      "rgb(255, 0 0)",
      "rgb(none, 0, 0)",
    ];
    expect(notColors(no)).toEqual(no);
  });

  test("does not read currentcolor or system colours", () => {
    const no = [
      "currentcolor",
      "CurrentColor",
      "Canvas",
      "ButtonText",
      "ActiveBorder",
    ];
    expect(notColors(no)).toEqual(no);
  });

  test("does not read calc, var, custom colour spaces, color-mix or relative colours", () => {
    const no = [
      "rgb(calc(10 + 5) 0 0)",
      "rgb(var(--r) 0 0)",
      "color(--my-profile 1 0 0)",
      "color-mix(in srgb, red, blue)",
      "rgb(from red r g b)",
    ];
    expect(notColors(no)).toEqual(no);
  });

  test("does not read surrounding whitespace or text after a colour", () => {
    const no = [
      " #fff",
      "#fff ",
      "red; width: 9999px",
      "url(https://example.com/a.png)",
    ];
    expect(notColors(no)).toEqual(no);
  });
});
