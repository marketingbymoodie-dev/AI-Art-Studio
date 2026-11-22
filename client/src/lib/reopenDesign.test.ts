import { beforeEach, describe, expect, it } from "vitest";
import {
  REOPEN_DESIGN_KEY,
  clearReopenDesign,
  pageHandleFromUrl,
  readReopenDesign,
  stashReopenFromHostUrl,
  stripReopenParams,
  writeReopenDesign,
} from "./reopenDesign";

const JOB = "6f1c2a9e-1111-4222-8333-444455556666";

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("pageHandleFromUrl", () => {
  it("reads /pages/:handle, the phone shell and creator designer", () => {
    expect(pageHandleFromUrl(new URL("https://s.myshopify.com/pages/Pet-Tee?x=1"))).toBe("pet-tee");
    expect(pageHandleFromUrl(new URL("https://s.myshopify.com/apps/appai/s/designer?page=pet-tee"))).toBe("pet-tee");
    expect(pageHandleFromUrl(new URL("https://app.example/s/designer?pageHandle=mug"))).toBe("mug");
    expect(pageHandleFromUrl(new URL("https://s.myshopify.com/"))).toBe("");
  });
});

describe("reopen entry", () => {
  it("round-trips for its own page only", () => {
    writeReopenDesign(window, { id: JOB, handle: "Pet-Tee", mockup: "https://cdn/m.png" });
    expect(readReopenDesign(window, "pet-tee")).toMatchObject({ id: JOB, handle: "pet-tee", mockup: "https://cdn/m.png" });
    expect(readReopenDesign(window, "mug")).toBeNull();
    expect(readReopenDesign(window, "")).toBeNull();
  });

  it("clears", () => {
    writeReopenDesign(window, { id: JOB, handle: "pet-tee" });
    clearReopenDesign(window);
    expect(sessionStorage.getItem(REOPEN_DESIGN_KEY)).toBeNull();
  });

  it("ignores writes without an id or handle", () => {
    writeReopenDesign(window, { id: "", handle: "pet-tee" });
    writeReopenDesign(window, { id: JOB, handle: "" });
    expect(sessionStorage.getItem(REOPEN_DESIGN_KEY)).toBeNull();
  });
});

describe("stripReopenParams", () => {
  it("removes every job-id carrier and keeps other params", () => {
    const url = new URL(
      `https://s.myshopify.com/pages/pet-tee?loadDesignId=${JOB}&loadMockup=m&loadProductName=Tee&reuseJobId=${JOB}&selectedVariant=7`,
    );
    expect(stripReopenParams(url)).toEqual({ id: JOB, mockup: "m", productName: "Tee" });
    expect(url.search).toBe("?selectedVariant=7");
    expect(url.toString()).not.toContain(JOB);
  });

  it("returns null when there is nothing to strip", () => {
    expect(stripReopenParams(new URL("https://s.myshopify.com/pages/pet-tee?size=M"))).toBeNull();
  });
});

describe("stashReopenFromHostUrl (legacy link arrival)", () => {
  it("moves the id into storage and out of the address bar", () => {
    window.history.replaceState(null, "", `/pages/pet-tee?loadDesignId=${JOB}&loadMockup=m`);
    const entry = stashReopenFromHostUrl(window);
    expect(entry).toMatchObject({ id: JOB, handle: "pet-tee", mockup: "m" });
    expect(window.location.href).not.toContain(JOB);
    expect(window.location.pathname).toBe("/pages/pet-tee");
    // hard refresh: URL has nothing, storage still restores on this page
    expect(readReopenDesign(window, pageHandleFromUrl(new URL(window.location.href)))?.id).toBe(JOB);
  });

  it("is a no-op on a clean URL", () => {
    window.history.replaceState(null, "", "/pages/pet-tee");
    expect(stashReopenFromHostUrl(window)).toBeNull();
    expect(sessionStorage.getItem(REOPEN_DESIGN_KEY)).toBeNull();
  });
});
