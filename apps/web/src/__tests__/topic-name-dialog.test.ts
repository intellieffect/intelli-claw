import { describe, it, expect } from "vitest";

/**
 * sanitizeTopicName: user input → valid topic ID
 * - lowercase
 * - spaces → hyphens
 * - remove special chars (keep alphanumeric, hangul, hyphens)
 * - max 50 chars
 * - empty/whitespace-only → null (fallback to auto-generated)
 */
function importSanitize() {
  // Will be implemented in topic-name-dialog.tsx
  return import("@/components/chat/topic-name-dialog").then((m) => m.sanitizeTopicName);
}

describe("sanitizeTopicName", () => {
  it("converts spaces to hyphens and lowercases", async () => {
    const sanitize = await importSanitize();
    expect(sanitize("My Cool Topic")).toBe("my-cool-topic");
  });

  it("preserves hangul characters", async () => {
    const sanitize = await importSanitize();
    expect(sanitize("버그 수정")).toBe("버그-수정");
  });

  it("removes special characters", async () => {
    const sanitize = await importSanitize();
    expect(sanitize("test@#$%!")).toBe("test");
  });

  it("handles mixed hangul, alphanumeric, and special chars", async () => {
    const sanitize = await importSanitize();
    expect(sanitize("API 연동 #v2")).toBe("api-연동-v2");
  });

  it("collapses consecutive hyphens", async () => {
    const sanitize = await importSanitize();
    expect(sanitize("hello   world")).toBe("hello-world");
    expect(sanitize("a---b")).toBe("a-b");
  });

  it("trims leading/trailing hyphens", async () => {
    const sanitize = await importSanitize();
    expect(sanitize(" hello ")).toBe("hello");
    expect(sanitize("--test--")).toBe("test");
  });

  it("truncates to max 50 characters", async () => {
    const sanitize = await importSanitize();
    const long = "a".repeat(60);
    const result = sanitize(long);
    expect(result!.length).toBeLessThanOrEqual(50);
    expect(result).toBe("a".repeat(50));
  });

  it("returns null for empty input", async () => {
    const sanitize = await importSanitize();
    expect(sanitize("")).toBeNull();
  });

  it("returns null for whitespace-only input", async () => {
    const sanitize = await importSanitize();
    expect(sanitize("   ")).toBeNull();
  });

  it("returns null for special-chars-only input", async () => {
    const sanitize = await importSanitize();
    expect(sanitize("@#$%!")).toBeNull();
  });

  it("preserves numbers", async () => {
    const sanitize = await importSanitize();
    expect(sanitize("sprint 42")).toBe("sprint-42");
  });

  it("handles single character", async () => {
    const sanitize = await importSanitize();
    expect(sanitize("A")).toBe("a");
  });
});
