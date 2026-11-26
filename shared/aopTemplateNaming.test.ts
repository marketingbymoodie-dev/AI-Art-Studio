import { describe, expect, it } from "vitest";
import { resolvePublicTemplateName, slugifyAdminToPublicName } from "./aopTemplateNaming";

describe("resolvePublicTemplateName", () => {
  it("keeps the exact-key legacy wrap map (not Square_Pillow)", () => {
    expect(resolvePublicTemplateName("Spun_Polyester")).toBe("spun-polyester-pillow-wrap-L");
  });

  it("slugifies the square-pillow admin slug — does not inherit the wrap-L map", () => {
    expect(slugifyAdminToPublicName("Spun_Polyester_Square_Pillow")).toBe(
      "spun-polyester-square-pillow",
    );
    expect(resolvePublicTemplateName("Spun_Polyester_Square_Pillow")).toBe(
      "spun-polyester-square-pillow",
    );
    expect(resolvePublicTemplateName("Faux_Suede_Square_Pillow")).toBe("faux-suede-square-pillow");
  });
});
