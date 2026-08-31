import { describe, expect, it } from "vitest";
import {
  SAFE_FILENAME_RE,
  isMapperMockupSrc,
  isSafeMapperFilename,
  mapperMockupFilenameFromSrc,
} from "./aopMapperFilename";

describe("SAFE_FILENAME_RE", () => {
  it("is anchored start-to-end", () => {
    expect(SAFE_FILENAME_RE.source.startsWith("^")).toBe(true);
    expect(SAFE_FILENAME_RE.source.endsWith("$")).toBe(true);
  });

  it("accepts garment mockup basenames", () => {
    expect(isSafeMapperFilename("Spun_Polyester_Square_Pillow-front.png")).toBe(true);
    expect(isSafeMapperFilename("Spun_Polyester_Square_Pillow-back.png")).toBe(true);
    expect(isSafeMapperFilename("unisex-zip-hoodie-aop-L-front.webp")).toBe(true);
  });
});

describe("isSafeMapperFilename — traversal and encoding", () => {
  const rejected = [
    "../secret.png",
    "..\\secret.png",
    "/etc/passwd.png",
    "C:\\Windows\\x.png",
    "..%2f..%2fsecret.png",
    "%2e%2e%2fsecret.png",
    "foo%00.png",
    "foo.png\0.jpg",
    "foo/bar.png",
    "foo\\bar.png",
    "..png",
    "foo..png",
    "foo.png.jpg",
    ".hidden.png",
    "-leading.png",
    "no-extension",
    "file.svg",
    "file.gif",
    "",
    `${"a".repeat(93)}.png`,
  ];

  for (const name of rejected) {
    it(`rejects ${JSON.stringify(name)}`, () => {
      expect(isSafeMapperFilename(name)).toBe(false);
    });
  }

  it("rejects non-strings", () => {
    expect(isSafeMapperFilename(null)).toBe(false);
    expect(isSafeMapperFilename(undefined)).toBe(false);
    expect(isSafeMapperFilename(12)).toBe(false);
  });
});

describe("mapper mockup src helpers", () => {
  it("detects admin authoring URLs", () => {
    expect(
      isMapperMockupSrc(
        "/api/platform/aop-mapper/mockups/Spun_Polyester_Square_Pillow-front.png",
      ),
    ).toBe(true);
    expect(
      isMapperMockupSrc(
        "https://ai-art-studio-staging.up.railway.app/api/platform/aop-mapper/mockups/x-front.png",
      ),
    ).toBe(true);
    expect(isMapperMockupSrc("/api/dev/hoodie-mapper/mockups/x-front.png")).toBe(true);
    expect(
      isMapperMockupSrc(
        "https://sflcdeqwxltsepmllzzu.supabase.co/storage/v1/object/public/hoodie-templates/mockups/x-front.png",
      ),
    ).toBe(false);
  });

  it("extracts an allowlisted basename and refuses traversal", () => {
    expect(
      mapperMockupFilenameFromSrc(
        "/api/platform/aop-mapper/mockups/Spun_Polyester_Square_Pillow-front.png",
      ),
    ).toBe("Spun_Polyester_Square_Pillow-front.png");
    expect(
      mapperMockupFilenameFromSrc("/api/platform/aop-mapper/mockups/../secret.png"),
    ).toBeNull();
  });
});
