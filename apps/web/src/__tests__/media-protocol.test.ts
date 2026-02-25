import { describe, it, expect } from "vitest";

// ============================================================
// Pure function replicas from hooks.tsx & message-list.tsx
// for unit testing MEDIA: protocol handling (#28)
// ============================================================

interface DisplayAttachment {
  fileName: string;
  mimeType: string;
  dataUrl?: string;
  downloadUrl?: string;
}

interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls: unknown[];
  streaming?: boolean;
  attachments?: DisplayAttachment[];
  queued?: boolean;
}

/**
 * Replica of hooks.tsx extractMediaAttachments (L203-234)
 */
function extractMediaAttachments(text: string): { cleanedText: string; attachments: DisplayAttachment[] } {
  const MEDIA_RE = /^MEDIA:(.+)$/gm;
  const attachments: DisplayAttachment[] = [];
  let match: RegExpExecArray | null;
  while ((match = MEDIA_RE.exec(text)) !== null) {
    const raw = match[1].trim();
    const fileName = raw.split("/").pop() || raw;
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const MIME_MAP: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
      webp: "image/webp", svg: "image/svg+xml",
      pdf: "application/pdf", zip: "application/zip",
      mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
      mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
      json: "application/json", csv: "text/csv", txt: "text/plain",
    };
    const mimeType = MIME_MAP[ext] || "application/octet-stream";
    const isImage = mimeType.startsWith("image/");
    const isHttp = raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:");
    const downloadUrl = isHttp ? raw : `/api/media?path=${encodeURIComponent(raw)}`;
    attachments.push({
      fileName,
      mimeType,
      dataUrl: isImage ? downloadUrl : undefined,
      downloadUrl,
    });
  }
  const cleanedText = text.replace(/^MEDIA:.+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return { cleanedText, attachments };
}

/**
 * Replica of message-list.tsx message filter (L202) — BEFORE fix
 */
function messageFilterBefore(msg: DisplayMessage): boolean {
  return !!(msg.content || msg.toolCalls.length > 0 || msg.streaming);
}

/**
 * Replica of message-list.tsx message filter (L202) — AFTER fix
 */
function messageFilterAfter(msg: DisplayMessage): boolean {
  return !!(msg.content || msg.toolCalls.length > 0 || msg.streaming || (msg.attachments && msg.attachments.length > 0));
}

/**
 * Simulates streaming attachment merge logic — BEFORE fix
 */
function mergeAttachmentsBefore(
  streamAttachments: DisplayAttachment[] | undefined,
  _prevAttachments: DisplayAttachment[] | undefined,
): DisplayAttachment[] | undefined {
  return streamAttachments;
}

/**
 * Simulates streaming attachment merge logic — AFTER fix
 */
function mergeAttachmentsAfter(
  streamAttachments: DisplayAttachment[] | undefined,
  prevAttachments: DisplayAttachment[] | undefined,
): DisplayAttachment[] | undefined {
  return streamAttachments ?? prevAttachments;
}

// ============================================================
// Test helpers
// ============================================================

function makeMsg(overrides: Partial<DisplayMessage> = {}): DisplayMessage {
  return {
    id: "test-1",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    toolCalls: [],
    streaming: false,
    ...overrides,
  };
}

function makeAttachment(fileName: string): DisplayAttachment {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const mimeMap: Record<string, string> = { png: "image/png", jpg: "image/jpeg", pdf: "application/pdf" };
  return {
    fileName,
    mimeType: mimeMap[ext] || "application/octet-stream",
    downloadUrl: `/api/media?path=${encodeURIComponent("/tmp/" + fileName)}`,
    dataUrl: mimeMap[ext]?.startsWith("image/") ? `/api/media?path=${encodeURIComponent("/tmp/" + fileName)}` : undefined,
  };
}

// ============================================================
// Tests
// ============================================================

describe("extractMediaAttachments", () => {
  it("단일 MEDIA 라인에서 attachment 추출", () => {
    const text = "MEDIA:/tmp/test.png";
    const result = extractMediaAttachments(text);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].fileName).toBe("test.png");
    expect(result.attachments[0].mimeType).toBe("image/png");
    expect(result.attachments[0].dataUrl).toContain("/api/media");
    expect(result.cleanedText).toBe("");
  });

  it("여러 MEDIA 라인에서 모든 attachment 추출", () => {
    const text = "MEDIA:/tmp/a.png\nMEDIA:/tmp/b.jpg\nMEDIA:/tmp/c.webp\nMEDIA:/tmp/d.gif";
    const result = extractMediaAttachments(text);

    expect(result.attachments).toHaveLength(4);
    expect(result.attachments[0].fileName).toBe("a.png");
    expect(result.attachments[1].fileName).toBe("b.jpg");
    expect(result.attachments[2].fileName).toBe("c.webp");
    expect(result.attachments[3].fileName).toBe("d.gif");
    expect(result.cleanedText).toBe("");
  });

  it("텍스트 + MEDIA 혼합에서 정상 분리", () => {
    const text = "이미지 결과입니다:\nMEDIA:/tmp/result.png\n분석 완료.";
    const result = extractMediaAttachments(text);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].fileName).toBe("result.png");
    expect(result.cleanedText).toBe("이미지 결과입니다:\n\n분석 완료.");
  });

  it("MEDIA 전용 메시지에서 cleanedText가 빈 문자열", () => {
    const text = "MEDIA:/tmp/a.png\nMEDIA:/tmp/b.png";
    const result = extractMediaAttachments(text);

    expect(result.attachments).toHaveLength(2);
    expect(result.cleanedText).toBe("");
  });

  it("HTTP URL MEDIA 처리", () => {
    const text = "MEDIA:https://example.com/image.png";
    const result = extractMediaAttachments(text);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].downloadUrl).toBe("https://example.com/image.png");
  });

  it("비이미지 파일(PDF) MEDIA 처리 — dataUrl은 undefined", () => {
    const text = "MEDIA:/tmp/doc.pdf";
    const result = extractMediaAttachments(text);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].mimeType).toBe("application/pdf");
    expect(result.attachments[0].dataUrl).toBeUndefined();
    expect(result.attachments[0].downloadUrl).toContain("/api/media");
  });

  it("MEDIA가 없는 일반 텍스트 — 빈 attachments", () => {
    const text = "일반 텍스트 메시지입니다.";
    const result = extractMediaAttachments(text);

    expect(result.attachments).toHaveLength(0);
    expect(result.cleanedText).toBe("일반 텍스트 메시지입니다.");
  });

  it("연속 3개 이상 개행이 2개로 정리됨", () => {
    const text = "위\nMEDIA:/tmp/a.png\n\n\n\n아래";
    const result = extractMediaAttachments(text);

    expect(result.cleanedText).toBe("위\n\n아래");
  });
});

describe("BUG-1: 메시지 필터 — MEDIA 전용 메시지 렌더링 제외", () => {
  it("[Before Fix] MEDIA 전용 메시지가 필터에서 제외됨", () => {
    const text = "MEDIA:/tmp/a.png\nMEDIA:/tmp/b.png";
    const { cleanedText, attachments } = extractMediaAttachments(text);

    const msg = makeMsg({ content: cleanedText, attachments });
    // content === "", toolCalls === [], streaming === false
    expect(messageFilterBefore(msg)).toBe(false); // ← 버그: 렌더링 제외
  });

  it("[After Fix] MEDIA 전용 메시지가 필터를 통과함", () => {
    const text = "MEDIA:/tmp/a.png\nMEDIA:/tmp/b.png";
    const { cleanedText, attachments } = extractMediaAttachments(text);

    const msg = makeMsg({ content: cleanedText, attachments });
    expect(messageFilterAfter(msg)).toBe(true); // ← 수정: attachments가 있으므로 통과
  });

  it("[After Fix] 빈 메시지(content 없음, attachments 없음)는 여전히 제외", () => {
    const msg = makeMsg({ content: "", attachments: undefined });
    expect(messageFilterAfter(msg)).toBe(false);
  });

  it("[After Fix] 텍스트만 있는 메시지는 정상 통과", () => {
    const msg = makeMsg({ content: "안녕하세요" });
    expect(messageFilterAfter(msg)).toBe(true);
  });

  it("[After Fix] toolCalls만 있는 메시지는 정상 통과", () => {
    const msg = makeMsg({ toolCalls: [{ callId: "1", name: "test" }] });
    expect(messageFilterAfter(msg)).toBe(true);
  });

  it("[After Fix] streaming 중인 메시지는 정상 통과", () => {
    const msg = makeMsg({ streaming: true });
    expect(messageFilterAfter(msg)).toBe(true);
  });

  it("[After Fix] 빈 attachments 배열은 통과하지 않음", () => {
    const msg = makeMsg({ content: "", attachments: [] });
    expect(messageFilterAfter(msg)).toBe(false);
  });
});

describe("BUG-2: 스트리밍 중 attachments 덮어쓰기 방지", () => {
  const prevAttachments = [makeAttachment("a.png"), makeAttachment("b.png")];

  it("[Before Fix] streamAttachments가 undefined이면 이전 attachments 유실", () => {
    const result = mergeAttachmentsBefore(undefined, prevAttachments);
    expect(result).toBeUndefined(); // ← 버그: 이전 [a, b] 유실
  });

  it("[After Fix] streamAttachments가 undefined이면 이전 attachments 유지", () => {
    const result = mergeAttachmentsAfter(undefined, prevAttachments);
    expect(result).toEqual(prevAttachments); // ← 수정: [a, b] 유지
  });

  it("[After Fix] streamAttachments가 있으면 새 값 사용", () => {
    const newAttachments = [makeAttachment("c.png")];
    const result = mergeAttachmentsAfter(newAttachments, prevAttachments);
    expect(result).toEqual(newAttachments);
  });

  it("[After Fix] 둘 다 undefined이면 undefined", () => {
    const result = mergeAttachmentsAfter(undefined, undefined);
    expect(result).toBeUndefined();
  });
});

describe("스트리밍 시나리오 통합 테스트", () => {
  it("chunk 단위 누적 후 최종 상태에서 모든 MEDIA 표시", () => {
    // 실제 스트리밍 시뮬레이션: streamBuf.content는 누적
    let streamBufContent = "";

    // chunk 1: MEDIA 2개
    streamBufContent += "MEDIA:/tmp/a.png\nMEDIA:/tmp/b.png\n";
    let extracted = extractMediaAttachments(streamBufContent);
    expect(extracted.attachments).toHaveLength(2);

    // chunk 2: 텍스트만 추가
    streamBufContent += "분석 결과입니다.";
    extracted = extractMediaAttachments(streamBufContent);
    expect(extracted.attachments).toHaveLength(2); // 여전히 2개 — snap.content 누적이므로
    expect(extracted.cleanedText).toContain("분석 결과입니다.");

    // chunk 3: MEDIA 2개 추가
    streamBufContent += "\nMEDIA:/tmp/c.png\nMEDIA:/tmp/d.png";
    extracted = extractMediaAttachments(streamBufContent);
    expect(extracted.attachments).toHaveLength(4); // 총 4개
  });

  it("MEDIA 라인이 chunk 경계에서 불완전한 경우", () => {
    let streamBufContent = "";

    // chunk 1: MEDIA 라인 도중 끊김
    streamBufContent += "MEDIA:/tmp/a.png\nMEDIA:/tmp/b.pn";
    let extracted = extractMediaAttachments(streamBufContent);
    // "MEDIA:/tmp/b.pn"는 줄 끝이므로 매치됨 (정규식 $는 줄 끝)
    // 하지만 확장자가 "pn"이므로 mimeType은 "application/octet-stream"
    expect(extracted.attachments).toHaveLength(2);
    expect(extracted.attachments[1].mimeType).toBe("application/octet-stream");

    // chunk 2: 나머지 도착 — 전체 누적에서 재파싱
    streamBufContent = "MEDIA:/tmp/a.png\nMEDIA:/tmp/b.png\n추가텍스트";
    extracted = extractMediaAttachments(streamBufContent);
    expect(extracted.attachments).toHaveLength(2);
    expect(extracted.attachments[1].fileName).toBe("b.png");
    expect(extracted.attachments[1].mimeType).toBe("image/png");
  });

  it("lifecycle:end 최종 처리 시 모든 MEDIA 포함", () => {
    // streamBuf.content 원본 (MEDIA 라인 포함 상태)
    const finalContent = "MEDIA:/tmp/style-1.png\nMEDIA:/tmp/style-2.png\nMEDIA:/tmp/style-3.png\nMEDIA:/tmp/style-4.png";
    const extracted = extractMediaAttachments(finalContent);

    expect(extracted.attachments).toHaveLength(4);
    expect(extracted.cleanedText).toBe("");

    // 최종 메시지 생성
    const msg = makeMsg({
      content: extracted.cleanedText,
      attachments: extracted.attachments.length > 0 ? extracted.attachments : undefined,
      streaming: false,
    });

    // Fix 후 필터 통과 확인
    expect(messageFilterAfter(msg)).toBe(true);
    expect(msg.attachments).toHaveLength(4);
  });
});
