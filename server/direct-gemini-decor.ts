/**
 * Direct-Gemini decor output rules (renderer layer, not creative content).
 *
 * Nano Banana 2 read "wall art / environmental storytelling" as a room or product
 * mockup. These rules state what the output file is; they precede every style /
 * concept layer and leave the Petposterous creative prompts unchanged.
 */

export const PRINT_ARTWORK_OUTPUT = `PRINT ARTWORK OUTPUT
Generate the actual print-ready artwork file itself.
The entire image canvas is the artwork that will be printed.
Do not depict the artwork as a poster, framed print, canvas, tapestry, pillow, comforter, product mockup, gallery display, wall hanging, room interior, photograph of artwork, sheet of paper or object inside another scene.
Any environmental storytelling must occur inside the artwork itself.
Fill the required print canvas deliberately to the edges where the product treatment specifies full bleed.
Do not add a frame, mat, border, paper edge, hanging hardware, wall, floor, furniture or display environment unless those objects are themselves explicitly part of the creative concept.`;

export const SUBJECT_INTEGRITY = `SUBJECT INTEGRITY
Render each intended pet/person exactly once unless the selected concept explicitly requires repetition. Do not create duplicate heads, tails, limbs, partial duplicate subjects or extra animals.`;

export const FULL_BLEED_WALL_ART = `FULL BLEED
No decorative outer border or unintended cream/white margin. Artwork should reach the canvas edges.`;

export function withDirectGeminiDecorRules(prompt: string, opts: { fullBleedWallArt: boolean }): string {
  const rules = [PRINT_ARTWORK_OUTPUT, SUBJECT_INTEGRITY, ...(opts.fullBleedWallArt ? [FULL_BLEED_WALL_ART] : [])];
  return `${rules.join("\n\n")}\n\n${prompt}`;
}
