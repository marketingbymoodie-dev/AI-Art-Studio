import { describe, expect, it } from "vitest";
import { normalizeAopPanels, pickAopPanelsForOrderLine } from "./aop-line-snapshot";

describe("normalizeAopPanels", () => {
  it("keeps hosted panels and drops junk", () => {
    expect(
      normalizeAopPanels([
        { position: "front", url: "https://cdn.example/a.png" },
        { position: "back", url: "data:image/png;base64,xx" },
        { position: "", url: "https://cdn.example/b.png" },
      ]),
    ).toEqual([{ position: "front", url: "https://cdn.example/a.png" }]);
  });
});

describe("pickAopPanelsForOrderLine", () => {
  it("prefers the cart-line snapshot over the shared job", () => {
    const job = [{ position: "front", url: "https://cdn.example/latest.png" }];
    const line = [{ position: "front", url: "https://cdn.example/first.png" }];
    expect(pickAopPanelsForOrderLine(line, job)).toEqual(line);
    expect(pickAopPanelsForOrderLine(null, job)).toEqual(job);
    expect(pickAopPanelsForOrderLine([], job)).toEqual(job);
  });
});
