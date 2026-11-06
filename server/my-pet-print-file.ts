/**
 * Order-time print file for a My Pet design. The pet-edited artwork (stored at
 * render time in the `mockup-library` bucket, same bucket the compositor reads
 * from) is run through the same vectorize/upscale path the catalogue itself
 * uses (`buildFlywheelPrintFile`) onto that product type's stored print canvas,
 * then re-uploaded so Printify can fetch it by URL.
 *
 * Built only on purchase — never at preview time (plan section 4).
 */
import { buildFlywheelPrintFile, printCanvasFromStoredPlaceholders } from "./flywheel-print-file";
import { readLibraryObject, signedLibraryUrl, writeLibraryObject } from "./mockup-library-store";

export async function buildMyPetPrintArea(args: {
  renderId: string;
  editedArtworkPath: string;
  artStyle: string;
  productTypePlaceholderPositions: unknown;
  productTypeName: string;
}): Promise<{ url: string; path: string }> {
  const source = await readLibraryObject(args.editedArtworkPath);
  const canvas = printCanvasFromStoredPlaceholders(args.productTypePlaceholderPositions, args.productTypeName);
  const { buffer } = await buildFlywheelPrintFile(args.artStyle, source, canvas);
  const path = `my-pet/print-files/${args.renderId}.png`;
  await writeLibraryObject(path, buffer, "image/png");
  const url = await signedLibraryUrl(path);
  return { url, path };
}
