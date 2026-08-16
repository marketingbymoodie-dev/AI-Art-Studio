import { describe, expect, it } from "vitest";
import { isCreatorCartPrintifyTestOpen, requestLooksLikeStagingHost } from "./creator-config";

describe("isCreatorCartPrintifyTestOpen", () => {
  it("is open in development", () => {
    expect(isCreatorCartPrintifyTestOpen({ NODE_ENV: "development" })).toBe(true);
  });

  it("is closed on unnamed production", () => {
    expect(isCreatorCartPrintifyTestOpen({ NODE_ENV: "production" })).toBe(false);
  });

  it("is open on Railway staging", () => {
    expect(
      isCreatorCartPrintifyTestOpen({
        NODE_ENV: "production",
        RAILWAY_ENVIRONMENT: "staging",
      }),
    ).toBe(true);
  });
});

describe("requestLooksLikeStagingHost", () => {
  it("matches the Railway staging hostname", () => {
    expect(
      requestLooksLikeStagingHost({ hostname: "ai-art-studio-staging.up.railway.app" }),
    ).toBe(true);
  });

  it("rejects production hosts", () => {
    expect(requestLooksLikeStagingHost({ hostname: "appai-pod-production.up.railway.app" })).toBe(
      false,
    );
  });
});
