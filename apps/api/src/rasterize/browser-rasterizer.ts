import { launch, type BrowserWorker } from "@cloudflare/playwright";
import type {
  RasterImage,
  RasterizeFailure,
  Rasterizer,
  RenderShape,
  Result,
} from "@doodle/design-doc";
import { renderHtml, type Font } from "@doodle/renderer";

type Measured = {
  /** Families whose font data could not be loaded. */
  failedFonts: string[];
  /** The drawn root's box; null when nothing is drawn. */
  box: { width: number; height: number } | null;
};

/** Waits for the fonts, then reports failed font loads and the drawn root's box. */
const MEASURE_ROOT = `document.fonts.ready.then(() => {
  const failedFonts = [...document.fonts]
    .filter((face) => face.status === "error")
    .map((face) => face.family.replace(/^"|"$/g, "").replace(/\\\\(.)/g, "$1"));
  const root = document.body.firstElementChild;
  if (!root) return { failedFonts, box: null };
  const box = root.getBoundingClientRect();
  return { failedFonts, box: { width: box.width, height: box.height } };
})`;

function failure(message: string): Result<RasterImage, RasterizeFailure> {
  return { ok: false, reasons: [{ code: "rasterize-failed", message }] };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Draws the shape with the preview renderer in a browser from Browser Rendering. */
export function createBrowserRasterizer(deps: {
  browser: BrowserWorker;
  fonts: Font[];
}): Rasterizer {
  return {
    async rasterize(shape: RenderShape) {
      const html = renderHtml(shape, deps.fonts);
      if (!html.ok) {
        return failure(html.reasons.map((reason) => reason.message).join("; "));
      }

      try {
        const browser = await launch(deps.browser);
        try {
          const page = await browser.newPage({ deviceScaleFactor: 1 });
          await page.setContent(html.value);
          const { failedFonts, box } = (await page.evaluate(
            MEASURE_ROOT,
          )) as Measured;
          if (failedFonts.length > 0) {
            return failure(
              `font data could not be loaded for: ${failedFonts.join(", ")}`,
            );
          }
          if (box === null) return failure("the shape has no root to draw");
          const width = Math.max(1, Math.ceil(box.width));
          const height = Math.max(1, Math.ceil(box.height));
          await page.setViewportSize({ width, height });
          const bytes = await page.screenshot({
            type: "png",
            clip: { x: 0, y: 0, width, height },
          });
          return {
            ok: true,
            value: {
              contentType: "image/png",
              bytes: new Uint8Array(bytes),
              width,
              height,
            },
          };
        } finally {
          await browser.close().catch(() => undefined);
        }
      } catch (error) {
        return failure(messageOf(error));
      }
    },
  };
}
