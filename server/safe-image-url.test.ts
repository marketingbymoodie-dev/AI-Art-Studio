import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveAllowedImageUrl } from "./safe-image-url";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.PUBLIC_APP_URL = "https://app.example.com";
  process.env.SUPABASE_URL = "https://proj123.supabase.co";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveAllowedImageUrl — allowed origins", () => {
  it("accepts the Supabase designs bucket", () => {
    const r = resolveAllowedImageUrl(
      "https://proj123.supabase.co/storage/v1/object/public/designs/uploads/a.png",
    );
    expect(r.ok).toBe(true);
  });

  it("accepts Printify images and replicate output", () => {
    expect(resolveAllowedImageUrl("https://images.printify.com/x.png").ok).toBe(true);
    expect(resolveAllowedImageUrl("https://pbxt.replicate.delivery/x.png").ok).toBe(true);
  });

  it("resolves app-relative /objects/ paths against the configured origin, not the Host header", () => {
    const r = resolveAllowedImageUrl("/objects/uploads/a.png");
    expect(r).toEqual({ ok: true, url: "https://app.example.com/objects/uploads/a.png" });
  });
});

describe("resolveAllowedImageUrl — SSRF vectors are refused", () => {
  const blocked = [
    ["cloud metadata IP", "http://169.254.169.254/latest/meta-data/"],
    ["cloud metadata IP over https", "https://169.254.169.254/latest/meta-data/"],
    ["GCP metadata hostname", "https://metadata.google.internal/computeMetadata/v1/"],
    ["loopback", "http://127.0.0.1:5000/admin"],
    ["localhost by name", "http://localhost:5000/admin"],
    ["private 10/8", "https://10.0.0.5/internal"],
    ["private 192.168/16", "https://192.168.1.1/"],
    ["private 172.16/12", "https://172.20.0.3/"],
    ["railway internal DNS", "http://postgres.railway.internal:5432/"],
    ["IPv6 loopback", "http://[::1]/"],
    ["arbitrary external host", "https://evil.example.com/payload.png"],
    ["lookalike suffix host", "https://images.printify.com.evil.example.com/x.png"],
    ["file protocol", "file:///etc/passwd"],
  ] as const;

  for (const [label, url] of blocked) {
    it(`refuses ${label}`, () => {
      const r = resolveAllowedImageUrl(url);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
    });
  }

  it("refuses an empty imageUrl with 400", () => {
    const r = resolveAllowedImageUrl("");
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});
