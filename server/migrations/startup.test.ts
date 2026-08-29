import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("startup DATA_MIGRATIONS", () => {
  it("does not use a SQL string as a tagged-template tag (missing comma)", () => {
    const src = readFileSync("server/migrations/startup.ts", "utf8");
    const start = src.indexOf("const DATA_MIGRATIONS");
    const end = src.indexOf("];", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    // `sql1` `sql2`  or  `sql1`\n  // comment\n  `sql2`
    // calls the first string as a function → TypeError: "UPDATE ..." is not a function
    expect(block).not.toMatch(/`\s*(?:\/\/[^\n]*\s*)*`/);
  });
});
