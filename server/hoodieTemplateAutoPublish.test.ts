import { describe, expect, it } from "vitest";
import { applyPublishedMockupUrls, sanitiseTemplateForPublish } from "./hoodieTemplateAutoPublish";

describe("applyPublishedMockupUrls", () => {
  it("rewrites leftover admin mapper srcs to public URLs", () => {
    const tpl = sanitiseTemplateForPublish(
      {
        name: "Spun_Polyester_Square_Pillow",
        version: "hoodie-template/v1",
        views: {
          front: {
            mockup: {
              src: "/api/platform/aop-mapper/mockups/Spun_Polyester_Square_Pillow-front.png",
            },
            referenceOverlay: { src: "/secret" },
          },
          back: {
            mockup: {
              src: "/api/platform/aop-mapper/mockups/Spun_Polyester_Square_Pillow-back.png",
            },
          },
        },
      },
      "spun-polyester-square-pillow",
    );
    expect(tpl.views.front.referenceOverlay).toBeUndefined();

    applyPublishedMockupUrls(tpl, {
      front: "https://cdn.example/mockups/spun-polyester-square-pillow-front.png",
      back: "https://cdn.example/mockups/spun-polyester-square-pillow-back.png",
    });

    expect(tpl.views.front.mockup.src).toBe(
      "https://cdn.example/mockups/spun-polyester-square-pillow-front.png",
    );
    expect(tpl.views.back.mockup.src).toBe(
      "https://cdn.example/mockups/spun-polyester-square-pillow-back.png",
    );
  });
});
