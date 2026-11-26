import { describe, expect, it } from "vitest";
import { readPlatformReplicateToken } from "./generation-providers";

describe("readPlatformReplicateToken", () => {
  it("reads the replicate:shared env var and nothing else", () => {
    expect(readPlatformReplicateToken({ REPLICATE_API_TOKEN: "tok" })).toBe("tok");
  });

  it("throws naming the credential when the env var is absent", () => {
    expect(() => readPlatformReplicateToken({})).toThrow(/REPLICATE_API_TOKEN/);
    expect(() => readPlatformReplicateToken({})).toThrow(/replicate:shared/);
  });
});
