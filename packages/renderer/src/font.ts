export type Font = {
  family: string;
  weight?: number;
  style?: "normal" | "italic";
  data: Uint8Array;
  format: "woff2" | "woff" | "truetype";
};

const MIME: Record<Font["format"], string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  truetype: "font/ttf",
};

const FORMAT_HINT: Record<Font["format"], string> = {
  woff2: "woff2",
  woff: "woff",
  truetype: "truetype",
};

export function quoteCss(value: string): string {
  return `"${value.replace(/[\\"]/g, "\\$&").replace(/\n/g, "\\a ")}"`;
}

function toBase64(data: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fontFaceRule(font: Font): string {
  const declarations = [
    `font-family: ${quoteCss(font.family)}`,
    `src: url(data:${MIME[font.format]};base64,${toBase64(font.data)}) format("${FORMAT_HINT[font.format]}")`,
  ];
  if (font.weight !== undefined)
    declarations.push(`font-weight: ${font.weight}`);
  if (font.style !== undefined) declarations.push(`font-style: ${font.style}`);
  return `@font-face { ${declarations.join("; ")} }`;
}
