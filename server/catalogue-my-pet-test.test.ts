import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { MY_PET_DEFAULT_BASE_PROMPT, buildMyPetPrompt } from "@shared/myPetSettings";
import {
  catalogueMyPetEditReferences,
  catalogueMyPetTestArtworkPath,
  runCatalogueMyPetTest,
} from "./catalogue-my-pet-test";

describe("catalogue My Pet test", () => {
  it("keeps the storefront reference order and the My Pet prompt", () => {
    expect(catalogueMyPetEditReferences("https://design.example/art", "https://pet.example/photo")).toEqual([
      "https://design.example/art",
      "https://pet.example/photo",
    ]);
    const prompt = buildMyPetPrompt(
      { basePrompt: MY_PET_DEFAULT_BASE_PROMPT, styleTweaks: {} },
      { species: "husky", artStyle: "woodcut", punchline: "I LIVE HERE" },
    );
    expect(prompt).toContain("Image 1 is the finished design. Image 2 is the shopper's pet.");
    expect(prompt).toContain("Species: husky.");
    expect(prompt).toContain('Wording stays exactly: "I LIVE HERE".');
  });

  it("only accepts an operator test artwork path", () => {
    expect(catalogueMyPetTestArtworkPath("catalogue-my-pet-test/9ada1bcf-0657-4a3f-9443-86a4988f0c1e.png")).toBe(true);
    expect(catalogueMyPetTestArtworkPath("catalogue-import/art.png")).toBe(false);
    expect(catalogueMyPetTestArtworkPath("my-pet/edited/9ada1bcf-0657-4a3f-9443-86a4988f0c1e.png")).toBe(false);
    expect(catalogueMyPetTestArtworkPath("../catalogue-my-pet-test/9ada1bcf-0657-4a3f-9443-86a4988f0c1e.png")).toBe(false);
  });

  it("refuses a shop outside the Petposterous owner allowlist", async () => {
    await expect(runCatalogueMyPetTest({
      shop: "someone-else.myshopify.com",
      requestId: "9ada1bcf-0657-4a3f-9443-86a4988f0c1e",
      candidateId: "9ada1bcf-0657-4a3f-9443-86a4988f0c1e",
      drawId: "",
      imageData: "",
    })).rejects.toThrow(/Petposterous/);
  });

  it("does not create shopper records or charge customer credits", () => {
    const src = readFileSync(path.join(process.cwd(), "server/catalogue-my-pet-test.ts"), "utf8");
    expect(src).not.toMatch(/myPetRenders|myPetPetPhotos|myPetEmailCaptures|generationJobs|decrementCredits|uploadMyPetPhoto|generateMyPetRender/);
  });
});
