import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const layoutPath = resolve(__dirname, "../app/layout.tsx");
const cssPath = resolve(__dirname, "../styles/globals.css");

function readSrc(path: string) {
  return readFileSync(path, "utf-8");
}

describe("Font setup", () => {
  describe("layout.tsx", () => {
    it("imports geist font package", () => {
      const src = readSrc(layoutPath);
      expect(src).toMatch(/from\s+["']geist\/font\/sans["']/);
    });

    it("applies geist font variable class to html element", () => {
      const src = readSrc(layoutPath);
      expect(src).toMatch(/GeistSans\.variable/);
    });
  });

  describe("globals.css", () => {
    it("includes Pretendard CDN import", () => {
      const src = readSrc(cssPath);
      expect(src).toMatch(/pretendard/i);
    });

    it("sets --font-sans with Geist Sans and Pretendard in stack", () => {
      const src = readSrc(cssPath);
      // Should contain both fonts in the sans variable
      expect(src).toMatch(/--font-sans.*Geist\s*Sans/i);
      expect(src).toMatch(/--font-sans.*Pretendard/i);
    });

    it("does not reference Inter as primary font", () => {
      const src = readSrc(cssPath);
      // --font-sans should no longer start with Inter
      const fontSansLine = src.match(/--font-sans:\s*([^;]+);/)?.[1] ?? "";
      expect(fontSansLine).not.toMatch(/^["']?Inter["']?/);
    });
  });
});
