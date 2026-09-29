import { launch, type BrowserWorker } from "@cloudflare/playwright";
import type {
  RasterImage,
  RasterizeFailure,
  Rasterizer,
  RenderShape,
  Result,
} from "@doodle/design-doc";
import { renderHtml, type Font } from "@doodle/renderer";

type Box = { width: number; height: number };

/** Waits for the fonts, then measures the drawn root; null when nothing is drawn. */
const MEASURE_ROOT = `document.fonts.ready.then(() => {
  const root = document.body.firstElementChild;
  if (!root) return null;
  const box = root.getBoundingClientRect();
  return { width: box.width, height: box.height };
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
          const box = (await page.evaluate(MEASURE_ROOT)) as Box | null;
          if (box === null) return failure("the shape has no root to draw");
          await page.setViewportSize({
            width: Math.max(1, Math.ceil(box.width)),
            height: Math.max(1, Math.ceil(box.height)),
          });
          const bytes = await page.screenshot({
            type: "png",
            clip: { x: 0, y: 0, width: box.width, height: box.height },
          });
          return {
            ok: true,
            value: {
              contentType: "image/png",
              bytes: new Uint8Array(bytes),
              width: box.width,
              height: box.height,
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
