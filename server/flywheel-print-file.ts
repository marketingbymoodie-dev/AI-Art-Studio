/**
 * Print file for a flywheel catalogue design. Runs at approval only.
 * Four styles vectorize. Two upscale. The 1024 render is never stored as the print file.
 * Customizer bake and toLosslessPrintMaster are not used here.
 */
import sharp from "sharp";
import { vectorizeWithRecraft } from "./replicate-vectorizer";

/** Gildan 64000 / blueprint 145 front print area, 300 DPI. */
export const SOFTSTYLE_PRINT_PX = { width: 3852, height: 4398 } as const;

const PRINT_PATHS = {
  woodcut: "vectorize",
  "folk-graphic": "vectorize",
  "bold-type": "vectorize",
  "pen-ink": "vectorize",
  "vintage-engraving": "upscale",
  "retro-character": "upscale",
} as const;

export type FlywheelPrintPath = (typeof PRINT_PATHS)[keyof typeof PRINT_PATHS];

const ESRGAN_MODEL = "nightmareai/real-esrgan";

export function printFilePathForStyle(styleId: string): FlywheelPrintPath {
  const path = PRINT_PATHS[styleId as keyof typeof PRINT_PATHS];
  if (!path) throw new Error(`${styleId || "(none)"} has no print path`);
  return path;
}

/** One scale for both axes. The result is never stretched to the print canvas. */
export function fittedPrintPixels(
  srcWidth: number,
  srcHeight: number,
  target: { width: number; height: number } = SOFTSTYLE_PRINT_PX,
): { width: number; height: number } {
  if (!(srcWidth > 0) || !(srcHeight > 0)) throw new Error("Print source has no pixels");
  const scale = Math.min(target.width / srcWidth, target.height / srcHeight);
  return {
    width: Math.max(1, Math.round(srcWidth * scale)),
    height: Math.max(1, Math.round(srcHeight * scale)),
  };
}

/** Lanczos onto the print canvas. Artwork stays at its own aspect, centered. */
export async function placeOnPrintCanvas(image: Buffer): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const fitted = fittedPrintPixels(meta.width || 0, meta.height || 0);
  const resized = await sharp(image)
    .resize(fitted.width, fitted.height, { fit: "inside", kernel: "lanczos3", withoutEnlargement: false })
    .png()
    .toBuffer();
  const placed = await sharp(resized).metadata();
  const left = Math.max(0, Math.round((SOFTSTYLE_PRINT_PX.width - (placed.width || fitted.width)) / 2));
  const top = Math.max(0, Math.round((SOFTSTYLE_PRINT_PX.height - (placed.height || fitted.height)) / 2));
  return sharp({
    create: {
      width: SOFTSTYLE_PRINT_PX.width,
      height: SOFTSTYLE_PRINT_PX.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();
}

async function rasterizeSvgToFit(svg: Buffer, srcWidth: number, srcHeight: number): Promise<Buffer> {
  const fitted = fittedPrintPixels(srcWidth, srcHeight);
  return sharp(svg, { density: 300 })
    .resize(fitted.width, fitted.height, { fit: "inside", kernel: "lanczos3" })
    .png()
    .toBuffer();
}

type ReplicatePrediction = {
  status: string;
  error?: unknown;
  output?: unknown;
  urls?: { get?: string };
};

async function replicateJson(url: string, token: string, init: RequestInit = {}): Promise<ReplicatePrediction> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`Replicate HTTP ${response.status}`);
  return json as ReplicatePrediction;
}

/** Real-ESRGAN x4plus, face enhancement off, then Lanczos to the print canvas. */
async function upscaleForPrint(source: Buffer, styleId: string): Promise<Buffer> {
  const token = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
  if (!token) throw new Error(`${styleId} print file failed: REPLICATE_API_TOKEN is not set`);
  const prediction = await replicateJson("https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions", token, {
    method: "POST",
    body: JSON.stringify({
      input: {
        image: `data:image/png;base64,${source.toString("base64")}`,
        scale: 4,
        face_enhance: false,
      },
    }),
  });
  const getUrl = prediction.urls?.get;
  if (!getUrl) throw new Error(`${styleId} print file failed: upscaler returned no prediction`);
  let latest = prediction;
  const started = Date.now();
  while (latest.status === "starting" || latest.status === "processing") {
    if (Date.now() - started > 180_000) throw new Error(`${styleId} print file failed: upscaler timed out`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    latest = await replicateJson(getUrl, token);
  }
  if (latest.status !== "succeeded") throw new Error(`${styleId} print file failed: upscaler ${latest.status}`);
  const output = latest.output;
  const url = typeof output === "string" ? output : Array.isArray(output) ? String(output[0] || "") : "";
  if (!url) throw new Error(`${styleId} print file failed: upscaler returned no image`);
  const image = await fetch(url);
  if (!image.ok) throw new Error(`${styleId} print file failed: upscaler download HTTP ${image.status}`);
  return placeOnPrintCanvas(Buffer.from(await image.arrayBuffer()));
}

/**
 * Build the print file. A missing path throws with the style id and does not
 * return the source image.
 */
export async function buildFlywheelPrintFile(styleId: string, source: Buffer): Promise<{ path: FlywheelPrintPath; buffer: Buffer }> {
  const path = printFilePathForStyle(styleId);
  const meta = await sharp(source).metadata();
  const srcWidth = meta.width || 0;
  const srcHeight = meta.height || 0;
  if (path === "vectorize") {
    let svg: Buffer;
    try {
      svg = await vectorizeWithRecraft({ imageBuffer: source });
    } catch (err) {
      throw new Error(`${styleId} print file failed: ${(err as Error).message}`);
    }
    const raster = await rasterizeSvgToFit(svg, srcWidth, srcHeight);
    return { path, buffer: await placeOnPrintCanvas(raster) };
  }
  return { path, buffer: await upscaleForPrint(source, styleId) };
}
