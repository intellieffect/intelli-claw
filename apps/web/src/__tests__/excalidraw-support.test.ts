import { describe, it, expect } from "vitest";
import {
  isExcalidrawLanguage,
  parseExcalidrawJson,
  isExcalidrawFilePath,
} from "@/lib/excalidraw";

describe("excalidraw helpers (#8)", () => {
  it("detects excalidraw language token", () => {
    expect(isExcalidrawLanguage("excalidraw")).toBe(true);
    expect(isExcalidrawLanguage("Excalidraw")).toBe(true);
    expect(isExcalidrawLanguage("json")).toBe(false);
    expect(isExcalidrawLanguage("")).toBe(false);
  });

  it("parses valid excalidraw json", () => {
    const raw = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: [
        { id: "a", type: "rectangle", x: 10, y: 10, width: 100, height: 80 },
      ],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    });

    const parsed = parseExcalidrawJson(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.elements.length).toBe(1);
    expect(parsed?.appState.viewModeEnabled).toBe(true);
  });

  it("returns null for invalid json", () => {
    expect(parseExcalidrawJson("{not-json}")).toBeNull();
  });

  it("returns null when elements are missing", () => {
    const raw = JSON.stringify({ type: "excalidraw", version: 2 });
    expect(parseExcalidrawJson(raw)).toBeNull();
  });

  it("detects .excalidraw file extension", () => {
    expect(isExcalidrawFilePath("/tmp/diagram.excalidraw")).toBe(true);
    expect(isExcalidrawFilePath("https://a.com/flow.excalidraw?token=1")).toBe(true);
    expect(isExcalidrawFilePath("/tmp/diagram.json")).toBe(false);
  });
});
