import { describe, it, expect } from "vitest";
import {
  attachmentToPayload,
  type ChatAttachment,
} from "@/components/chat/file-attachments";

/**
 * #287: 텍스트 파일(CSV 등) 첨부 시 에이전트 인식 불가
 *
 * 일부 브라우저는 CSV/TSV/LOG 같은 텍스트 파일에 대해 `File.type`을 빈 문자열로
 * 두거나 `application/octet-stream`으로 설정한다. 이로 인해 gateway가 파일을
 * 텍스트로 인식하지 못하고 에이전트가 내용을 읽지 못한다.
 *
 * 수정안: `file.type`이 비어있거나 generic인 경우 파일 확장자로부터 MIME을
 * 도출해 payload에 포함시킨다.
 */

function makeFile(name: string, content: string, type: string): File {
  return new File([content], name, { type });
}

function makeAttachment(file: File): ChatAttachment {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    file,
    type: "file",
  };
}

describe("#287 CSV/text attachment MIME fallback", () => {
  it("derives text/csv MIME when browser sets file.type to empty string", async () => {
    const csv = "name,age\nAlice,30\nBob,25";
    // Simulate the buggy browser behavior: CSV with empty MIME type
    const att = makeAttachment(makeFile("data.csv", csv, ""));
    const result = await attachmentToPayload(att);

    expect(result.payloads.length).toBe(1);
    expect(result.payloads[0].fileName).toBe("data.csv");
    expect(result.payloads[0].mimeType).toBe("text/csv");
    expect(result.prependText).toBeDefined();
    expect(result.prependText).toContain("name,age");
    expect(result.prependText).toContain("Alice,30");
  });

  it("derives MIME from extension when file.type is application/octet-stream", async () => {
    const txt = "just some text";
    const att = makeAttachment(
      makeFile("notes.txt", txt, "application/octet-stream"),
    );
    const result = await attachmentToPayload(att);

    expect(result.payloads[0].mimeType).toBe("text/plain");
    expect(result.prependText).toContain("just some text");
  });

  it.each([
    ["data.csv", "text/csv"],
    ["notes.txt", "text/plain"],
    ["server.log", "text/plain"],
    ["config.json", "application/json"],
    ["app.yml", "application/yaml"],
    ["app.yaml", "application/yaml"],
    ["data.tsv", "text/tab-separated-values"],
    ["sitemap.xml", "application/xml"],
    ["readme.md", "text/markdown"],
  ])(
    "derives correct MIME for %s when file.type is empty",
    async (name, expectedMime) => {
      const att = makeAttachment(makeFile(name, "content", ""));
      const result = await attachmentToPayload(att);
      expect(result.payloads[0].mimeType).toBe(expectedMime);
    },
  );
});
