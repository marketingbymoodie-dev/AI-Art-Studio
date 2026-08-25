/**
 * WP-54: the upload endpoint accepts two different credentials (Shopify App
 * Bridge session token for platform admin, creator identity token for the
 * Creator Portal). The point of these tests is the negative case: a request
 * carrying NEITHER credential must be rejected, not merely that both valid
 * paths pass.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import type { Request, Response } from "express";

// isAuthenticated is a dev bypass when NODE_ENV === "development", and it is
// bound at module load — pin the env before importing anything under test.
process.env.NODE_ENV = "test";
// Always present in deployed environments; the Shopify verifier throws without it.
process.env.SHOPIFY_API_SECRET ||= "test-shopify-secret";
process.env.SHOPIFY_API_KEY ||= "test-shopify-key";

let requireUploadAuth: any;
let sniffImageType: any;
let STOREFRONT_UPLOAD_MAX_BYTES: number;
let signCreatorIdentityToken: (id: string) => string;

beforeAll(async () => {
  const mod = await import("./routes");
  ({ requireUploadAuth, sniffImageType, STOREFRONT_UPLOAD_MAX_BYTES } = mod.__testables);
  ({ signCreatorIdentityToken } = await import("../../creator-auth"));
});

function fakeReqRes(headers: Record<string, string> = {}) {
  const req = { headers } as unknown as Request;
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  } as unknown as Response;
  const next = vi.fn();
  return { req, res, next, sent };
}

describe("requireUploadAuth — rejects requests with no credential", () => {
  it("401s a request with no headers at all", () => {
    const { req, res, next, sent } = fakeReqRes();
    requireUploadAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(sent.status).toBe(401);
  });

  it("401s a request carrying an unrelated cookie", () => {
    const { req, res, next, sent } = fakeReqRes({ cookie: "cart=abc; theme=dark" });
    requireUploadAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(sent.status).toBe(401);
  });

  it("401s a forged creator token", () => {
    const { req, res, next, sent } = fakeReqRes({
      cookie: "appai_creator_token=not-a-real-jwt",
    });
    requireUploadAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(sent.status).toBe(401);
  });

  it("401s a creator token signed with the wrong secret", () => {
    // A JWT with a valid shape but signed by someone else must not pass.
    const forged =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
      "eyJzdWIiOiJjcmVhdG9yLTEiLCJ0eXAiOiJjcmVhdG9yX2lkZW50aXR5In0." +
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const { req, res, next, sent } = fakeReqRes({ cookie: `appai_creator_token=${forged}` });
    requireUploadAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(sent.status).toBe(401);
  });

  it("401s an invalid Shopify bearer token", () => {
    const { req, res, next, sent } = fakeReqRes({ authorization: "Bearer garbage.token.here" });
    requireUploadAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(sent.status).toBe(401);
  });
});

describe("requireUploadAuth — accepts a valid creator credential", () => {
  it("passes a valid creator cookie through to the handler", () => {
    const token = signCreatorIdentityToken("creator-123");
    const { req, res, next } = fakeReqRes({ cookie: `appai_creator_token=${token}` });
    requireUploadAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("passes a valid creator bearer token through to the handler", () => {
    const token = signCreatorIdentityToken("creator-123");
    const { req, res, next } = fakeReqRes({ authorization: `Bearer ${token}` });
    requireUploadAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("storefront upload input validation", () => {
  it("accepts real PNG and JPEG signatures", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
  });

  it("rejects payloads that only claim to be images", () => {
    expect(sniffImageType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImageType(Buffer.from("<!doctype html>"))).toBeNull();
    expect(sniffImageType(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });

  it("caps uploads above the largest real design measured on staging (24.16 MB)", () => {
    expect(STOREFRONT_UPLOAD_MAX_BYTES).toBe(32 * 1024 * 1024);
    expect(STOREFRONT_UPLOAD_MAX_BYTES).toBeGreaterThan(24.16 * 1024 * 1024);
  });
});
