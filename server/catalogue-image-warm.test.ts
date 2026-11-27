import { describe, expect, it, vi } from "vitest";
import { resizedImageUrl, warmCatalogueImageUrls } from "./catalogue-image-warm";

function response(status: number): Response {
  return new Response(null, { status });
}

describe("catalogue image warm", () => {
  it("adds the width to the Shopify file URL", () => {
    expect(resizedImageUrl("https://cdn.shopify.com/s/files/1/x/black.jpg?v=1", 720)).toBe(
      "https://cdn.shopify.com/s/files/1/x/black.jpg?v=1&width=720",
    );
  });

  it("retries a 502 and stops when the resized file returns 200", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(502))
      .mockResolvedValueOnce(response(200));
    const result = await warmCatalogueImageUrls(["https://cdn.shopify.com/s/files/1/x/black.jpg?v=1"], {
      widths: [720],
      maxTries: 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });
    expect(result.warmed).toBe(1);
    expect(result.failed).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("records a width that is still failing after the last try", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(502));
    const result = await warmCatalogueImageUrls(["https://cdn.shopify.com/s/files/1/x/black.jpg?v=1"], {
      widths: [120],
      maxTries: 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });
    expect(result.warmed).toBe(0);
    expect(result.failed).toEqual([{
      url: "https://cdn.shopify.com/s/files/1/x/black.jpg?v=1&width=120",
      width: 120,
      status: 502,
    }]);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});
