/**
 * Verifies the App-Proxy device-key path: body/query carries the signed blob,
 * cookie is a back-compat fallback, tampered values are rejected, and the
 * ensure wrapper returns both unsigned id + signed blob for echoing to the
 * client. See server/my-pet-device.ts for the rationale (Shopify App Proxy
 * strips Cookie headers, so cookies alone cannot carry the device identity).
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  MY_PET_DEVICE_COOKIE,
  ensureMyPetDeviceKeyFromProxy,
  readMyPetDeviceKeyFromProxy,
  signMyPetDeviceKey,
} from "./my-pet-device";

beforeEach(() => {
  process.env.MY_PET_DEVICE_SECRET = "test-secret";
});

function makeReq(opts: {
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  cookies?: Record<string, string>;
} = {}): any {
  return { body: opts.body || {}, query: opts.query || {}, cookies: opts.cookies || {} };
}

function makeRes(): any {
  const cookies: Record<string, { value: string; options: any }> = {};
  return {
    cookie(name: string, value: string, options: any) {
      cookies[name] = { value, options };
    },
    _cookies: cookies,
  };
}

describe("readMyPetDeviceKeyFromProxy", () => {
  it("prefers the body deviceKey when valid", () => {
    const signed = signMyPetDeviceKey("device-from-body");
    const req = makeReq({ body: { deviceKey: signed }, cookies: { [MY_PET_DEVICE_COOKIE]: signMyPetDeviceKey("cookie-id") } });
    expect(readMyPetDeviceKeyFromProxy(req)).toBe("device-from-body");
  });

  it("falls through to the query deviceKey when body is empty", () => {
    const signed = signMyPetDeviceKey("device-from-query");
    const req = makeReq({ query: { deviceKey: signed } });
    expect(readMyPetDeviceKeyFromProxy(req)).toBe("device-from-query");
  });

  it("falls through to the cookie when body and query are empty (legacy)", () => {
    const signed = signMyPetDeviceKey("cookie-id");
    const req = makeReq({ cookies: { [MY_PET_DEVICE_COOKIE]: signed } });
    expect(readMyPetDeviceKeyFromProxy(req)).toBe("cookie-id");
  });

  it("rejects a tampered body blob (wrong HMAC) and falls through", () => {
    const req = makeReq({
      body: { deviceKey: "forged-id.deadbeef" },
      cookies: { [MY_PET_DEVICE_COOKIE]: signMyPetDeviceKey("real-cookie-id") },
    });
    expect(readMyPetDeviceKeyFromProxy(req)).toBe("real-cookie-id");
  });

  it("returns null when every source is missing or tampered", () => {
    expect(readMyPetDeviceKeyFromProxy(makeReq())).toBeNull();
    expect(
      readMyPetDeviceKeyFromProxy(makeReq({ body: { deviceKey: "no-dot" }, query: { deviceKey: "also.bad" } })),
    ).toBeNull();
  });
});

describe("ensureMyPetDeviceKeyFromProxy", () => {
  it("returns the existing key and does NOT set a new cookie when the body carries a valid signed key", () => {
    const signed = signMyPetDeviceKey("existing-device");
    const req = makeReq({ body: { deviceKey: signed } });
    const res = makeRes();
    const out = ensureMyPetDeviceKeyFromProxy(req, res);
    expect(out.deviceKey).toBe("existing-device");
    expect(out.signed).toBe(signed);
    expect(res._cookies[MY_PET_DEVICE_COOKIE]).toBeUndefined();
  });

  it("mints a new key + sets the back-compat cookie when nothing is present", () => {
    const req = makeReq();
    const res = makeRes();
    const out = ensureMyPetDeviceKeyFromProxy(req, res);
    expect(out.deviceKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.signed).toBe(signMyPetDeviceKey(out.deviceKey));
    expect(res._cookies[MY_PET_DEVICE_COOKIE].value).toBe(out.signed);
    expect(res._cookies[MY_PET_DEVICE_COOKIE].options.sameSite).toBe("lax");
    expect(res._cookies[MY_PET_DEVICE_COOKIE].options.path).toBe("/");
  });

  it("the signed blob is self-verifying — the same key round-trips through body", () => {
    const req1 = makeReq();
    const res1 = makeRes();
    const first = ensureMyPetDeviceKeyFromProxy(req1, res1);
    const req2 = makeReq({ body: { deviceKey: first.signed } });
    const res2 = makeRes();
    const second = ensureMyPetDeviceKeyFromProxy(req2, res2);
    expect(second.deviceKey).toBe(first.deviceKey);
    expect(second.signed).toBe(first.signed);
    // No new cookie written on the second call — the key was already valid.
    expect(res2._cookies[MY_PET_DEVICE_COOKIE]).toBeUndefined();
  });
});
