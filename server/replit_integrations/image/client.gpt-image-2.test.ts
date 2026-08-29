import { describe, expect, it } from "vitest";
import { APPAREL_CHROMA_STYLE_BY_NAME } from "@shared/apparel-chroma-prompts";
import {
  APPAREL_BASE_TRANSPARENT,
  composeLayeredPrompt,
  LITERAL_TEXT_INSTRUCTION,
  LITERAL_TEXT_INTENT_FRAGMENT,
  literalUserSlotSchema,
  wrapLayeredArtworkPrompt,
} from "@shared/promptLayers";
import { chromaPlateLeakMatches } from "@shared/styleGeneration";
import {
  buildGptImage2ReplicateInput,
  compressPrompt,
} from "./client";

describe("buildGptImage2ReplicateInput", () => {
  it("defaults to low + transparent + png", () => {
    const input = buildGptImage2ReplicateInput({ prompt: "hello" });
    expect(input.quality).toBe("low");
    expect(input.background).toBe("transparent");
    expect(input.output_format).toBe("png");
    expect(input.number_of_images).toBe(1);
    expect(input.aspect_ratio).toBe("1:1");
    expect(input.input_images).toBeUndefined();
  });

  it("maps refs to input_images not image_input", () => {
    const input = buildGptImage2ReplicateInput({
      prompt: "hello",
      inputImageUrl: ["https://example.com/a.png", "https://example.com/b.png"],
      quality: "medium",
    });
    expect(input.input_images).toEqual([
      "https://example.com/a.png",
      "https://example.com/b.png",
    ]);
    expect(input.image_input).toBeUndefined();
    expect(input.quality).toBe("medium");
  });
});

describe("compressPrompt nativeTransparent", () => {
  it("does not inject #FF00FF or hot pink background", () => {
    const raw =
      `${APPAREL_CHROMA_STYLE_BY_NAME.opinionated} CATCH THIS\n\n` +
      `=== ARTWORK DESCRIPTION ===\nCATCH THIS`;
    const out = compressPrompt(raw, true, false, "CATCH THIS", false, "1:1", false, true);
    expect(chromaPlateLeakMatches(out)).toEqual([]);
    expect(out.toLowerCase()).toContain("transparent background");
    expect(out).not.toMatch(/#FF00FF/i);
    expect(out.toLowerCase()).not.toContain("hot pink background");
  });

  it("still injects chroma plate when nativeTransparent is off (legacy path)", () => {
    const out = compressPrompt("a bold slogan", true, false, "a bold slogan", false, "1:1", false, false);
    expect(out.toLowerCase()).toContain("#ff00ff");
  });

  it("layered path does not inject a second chroma plate", () => {
    const raw =
      `Isolated centered graphic on a SOLID HOT PINK (#FF00FF) background.\n\n` +
      `=== ARTWORK DESCRIPTION ===\nbold stacked typography`;
    const out = compressPrompt(raw, true, false, "I choose dogs", false, "1:1", false, false, true);
    expect(out).toContain("#FF00FF");
    expect((out.match(/#FF00FF/gi) || []).length).toBe(1);
    expect(out).not.toMatch(/Every pixel not part of the design must be exactly #FF00FF/i);
  });

  it("layered gpt-image-2 path does not inject chroma or re-wrap transparent", () => {
    const raw =
      `Isolated centered graphic on a TRANSPARENT background, for screen printing.\n\n` +
      `=== ARTWORK DESCRIPTION ===\nbold stacked typography`;
    const out = compressPrompt(raw, true, false, "I choose dogs", false, "1:1", false, true, true);
    expect(out).not.toMatch(/#FF00FF/i);
    expect(out.toLowerCase()).not.toContain("hot pink");
    expect((out.match(/TRANSPARENT background/gi) || []).length).toBe(1);
  });

  it("layered Opinionated does not prepend 15% safe-area or a second base", () => {
    const layered = composeLayeredPrompt({
      category: "apparel",
      isApparelGeneration: true,
      generationModel: "gpt-image-2",
      styleLayer: APPAREL_CHROMA_STYLE_BY_NAME.opinionated,
      subStyleLayer: "casual hand-lettered script, organic brush strokes, personal handwriting feel",
      userInput: "Murder is subjective",
      userSlotSchema: literalUserSlotSchema(6),
    });
    const raw = wrapLayeredArtworkPrompt(layered);
    const leftover =
      "Keep ALL text/letters/words at least 15% of the canvas away from the TOP and BOTTOM edges, " +
      "and at least 5% from the left and right edges (outer 15% top/bottom bands must contain no text). " +
      "Background/scene may still fill edge-to-edge. " +
      raw;
    const out = compressPrompt(leftover, true, false, "Murder is subjective", false, "1:1", false, true, true);
    const expected = [
      APPAREL_BASE_TRANSPARENT,
      APPAREL_CHROMA_STYLE_BY_NAME.opinionated,
      LITERAL_TEXT_INTENT_FRAGMENT,
      "casual hand-lettered script, organic brush strokes, personal handwriting feel",
      `${LITERAL_TEXT_INSTRUCTION}: "Murder is subjective"`,
    ].join("\n\n");
    expect(out).toBe(expected);
    expect((out.match(/TRANSPARENT background/gi) || []).length).toBe(1);
    expect(out).not.toMatch(/15% of the canvas/i);
    expect(out).not.toMatch(/Do not add text unless/i);
    expect(out).not.toMatch(/=== ARTWORK DESCRIPTION ===/);
  });
});
