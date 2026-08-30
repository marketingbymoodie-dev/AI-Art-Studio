import { describe, expect, it } from "vitest";
import { DEFAULT_DECOR_BACKGROUND_FILL, parseDecorBackgroundFill } from "./decorBackgroundFill";

describe("parseDecorBackgroundFill", () => {
  it("defaults to white", () => {
    expect(parseDecorBackgroundFill(undefined)).toBe(DEFAULT_DECOR_BACKGROUND_FILL);
    expect(parseDecorBackgroundFill(null)).toBe("#FFFFFF");
    expect(parseDecorBackgroundFill("not-a-color")).toBe("#FFFFFF");
  });

  it("accepts none and hex", () => {
    expect(parseDecorBackgroundFill("none")).toBe("none");
    expect(parseDecorBackgroundFill("")).toBe("none");
    expect(parseDecorBackgroundFill("#00ffaa")).toBe("#00FFAA");
  });
});
