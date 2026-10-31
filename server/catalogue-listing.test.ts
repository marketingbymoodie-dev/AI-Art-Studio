import { describe, expect, it } from "vitest";
import { parseCatalogueListing } from "./catalogue-listing";

describe("parseCatalogueListing", () => {
  it("keeps a supplied title and the written description", () => {
    expect(parseCatalogueListing(
      { title: "Something else", description: "The dog takes the bed." },
      "Bed Etiquette",
    )).toEqual([{ title: "Bed Etiquette", description: "The dog takes the bed." }]);
  });

  it("rejects an empty description", () => {
    expect(parseCatalogueListing({ title: "Bed Etiquette", description: "  " }, "Bed Etiquette")).toBeNull();
  });
});
