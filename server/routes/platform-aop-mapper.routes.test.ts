import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  path.resolve(process.cwd(), "server/routes/platform-aop-mapper.ts"),
  "utf-8",
);

describe("platform AOP mapper auth scope", () => {
  it("ungates only GET /mockups/:filename — every sibling stays isAuthenticated", () => {
    const routeRe =
      /app\.(get|post|delete|patch|put)\(\s*(?:`\$\{BASE\}([^`]+)`|[\s\S]*?)\s*,([\s\S]*?)(?:async |\(\s*req)/g;
    const publicGets: string[] = [];
    const gated: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = routeRe.exec(SOURCE))) {
      const method = match[1];
      const routePath = match[2] ?? "";
      const middleware = match[3] ?? "";
      const key = `${method.toUpperCase()} ${routePath}`;
      if (/\bisAuthenticated\b/.test(middleware)) {
        gated.push(key);
      } else {
        publicGets.push(key);
      }
    }

    expect(publicGets).toEqual(["GET /mockups/:filename"]);
    expect(gated).toEqual(
      expect.arrayContaining([
        "GET /templates",
        "GET /templates/:name",
        "POST /templates/:name",
        "POST /templates/:name/publish",
        "DELETE /templates/:name",
        "GET /mockups",
        "POST /mockups/:filename",
        "GET /source-panels",
        "GET /source-panels/:filename",
        "POST /source-panels/:filename",
        "GET /reference-overlays",
        "GET /reference-overlays/:filename",
        "POST /reference-overlays/:filename",
      ]),
    );
    expect(gated.some((k) => k.includes("printify-blanks"))).toBe(true);
    expect(gated).not.toContain("GET /mockups/:filename");
  });
});
