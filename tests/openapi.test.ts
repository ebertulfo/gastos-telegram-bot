import { describe, expect, it } from "vitest";
import { buildOpenApiSpec } from "../src/openapi";

describe("buildOpenApiSpec", () => {
  it("contains core endpoints", () => {
    const spec = buildOpenApiSpec("https://example.com");
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/health"]).toBeDefined();
    expect(spec.paths["/webhook/telegram"]).toBeDefined();
  });
});
