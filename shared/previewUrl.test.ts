import { describe, expect, it } from "vitest";
import {
  isPersistablePreviewUrl,
  normalizePreviewUrl,
  unwrapMangledPreviewUrl,
} from "./previewUrl";

const DATA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const HOSTED = "https://cdn.example.com/objects/mockup.png";
const RELATIVE = "/objects/designs/abc.png";
const PROXY_RELATIVE = "/apps/appai/objects/designs/abc.png";

describe("unwrapMangledPreviewUrl", () => {
  it("leaves a clean data: URI unchanged", () => {
    expect(unwrapMangledPreviewUrl(DATA)).toBe(DATA);
  });

  it("leaves a real hosted http(s) URL unchanged", () => {
    expect(unwrapMangledPreviewUrl(HOSTED)).toBe(HOSTED);
    expect(unwrapMangledPreviewUrl("http://cdn.example.com/x.png")).toBe(
      "http://cdn.example.com/x.png",
    );
  });

  it("strips https://<any-host>/data: back to data:", () => {
    expect(
      unwrapMangledPreviewUrl(
        `https://appai-pod-production.up.railway.app/${DATA}`,
      ),
    ).toBe(DATA);
    expect(
      unwrapMangledPreviewUrl(`https://appai-pod-staging.up.railway.app/${DATA}`),
    ).toBe(DATA);
    expect(unwrapMangledPreviewUrl(`https://localhost:5000/${DATA}`)).toBe(DATA);
  });

  it("strips /data: from ensureLeadingSlash", () => {
    expect(unwrapMangledPreviewUrl(`/${DATA}`)).toBe(DATA);
  });

  it("strips /apps/appai/data: from buildAppUrl", () => {
    expect(unwrapMangledPreviewUrl(`/apps/appai/${DATA}`)).toBe(DATA);
    expect(
      unwrapMangledPreviewUrl(
        `https://appai-pod-production.up.railway.app/apps/appai/${DATA}`,
      ),
    ).toBe(DATA);
  });

  it("peels an embedded http(s) URL from a proxy wrap", () => {
    expect(unwrapMangledPreviewUrl(`/apps/appai/${HOSTED}`)).toBe(HOSTED);
    expect(
      unwrapMangledPreviewUrl(
        `https://store.myshopify.com/apps/appai/${HOSTED}`,
      ),
    ).toBe(HOSTED);
  });

  it("leaves genuine relative paths unchanged", () => {
    expect(unwrapMangledPreviewUrl(RELATIVE)).toBe(RELATIVE);
    expect(unwrapMangledPreviewUrl(PROXY_RELATIVE)).toBe(PROXY_RELATIVE);
  });

  it("does not treat a query-string data: as a mangled preview", () => {
    const withQuery = "https://cdn.example.com/img.png?x=data:image/png;base64,xx";
    expect(unwrapMangledPreviewUrl(withQuery)).toBe(withQuery);
  });

  it("returns null/empty as-is", () => {
    expect(unwrapMangledPreviewUrl(null)).toBeNull();
    expect(unwrapMangledPreviewUrl(undefined)).toBeNull();
    expect(unwrapMangledPreviewUrl("")).toBe("");
    expect(unwrapMangledPreviewUrl("   ")).toBe("");
  });
});

describe("normalizePreviewUrl", () => {
  const prependHost = (path: string) => {
    const stripped = path.startsWith("/apps/appai")
      ? path.slice("/apps/appai".length)
      : path;
    return `https://app.example${stripped.startsWith("/") ? stripped : `/${stripped}`}`;
  };

  it("returns data: unchanged and does not prepend a host", () => {
    expect(normalizePreviewUrl(DATA, prependHost)).toBe(DATA);
    expect(
      normalizePreviewUrl(
        `https://appai-pod-production.up.railway.app/${DATA}`,
        prependHost,
      ),
    ).toBe(DATA);
    expect(normalizePreviewUrl(`/${DATA}`, prependHost)).toBe(DATA);
  });

  it("returns real hosted URLs unchanged", () => {
    expect(normalizePreviewUrl(HOSTED, prependHost)).toBe(HOSTED);
  });

  it("prepends host/base for genuine relative paths", () => {
    expect(normalizePreviewUrl(RELATIVE, prependHost)).toBe(
      "https://app.example/objects/designs/abc.png",
    );
    expect(normalizePreviewUrl(PROXY_RELATIVE, prependHost)).toBe(
      "https://app.example/objects/designs/abc.png",
    );
  });

  it("passes relatives through when no resolver is given", () => {
    expect(normalizePreviewUrl(RELATIVE)).toBe(RELATIVE);
  });
});

describe("isPersistablePreviewUrl", () => {
  it("accepts data: and hosted http(s)", () => {
    expect(isPersistablePreviewUrl(DATA)).toBe(true);
    expect(isPersistablePreviewUrl(HOSTED)).toBe(true);
    expect(isPersistablePreviewUrl(RELATIVE)).toBe(false);
  });
});
