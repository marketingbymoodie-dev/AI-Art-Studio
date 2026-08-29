import { describe, expect, it } from "vitest";
import { APPAREL_CHROMA_STYLE_BY_NAME } from "@shared/apparel-chroma-prompts";
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

  it("still injects chroma plate when nativeTransparent is off", () => {
    const out = compressPrompt("a bold slogan", true, false, "a bold slogan", false, "1:1", false, false);
    expect(out.toLowerCase()).toContain("#ff00ff");
  });
});
