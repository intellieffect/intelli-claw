export interface ExcalidrawInitialData {
  elements: Record<string, unknown>[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

export function isExcalidrawLanguage(lang: string): boolean {
  return lang.trim().toLowerCase() === "excalidraw";
}

export function isExcalidrawFilePath(path: string): boolean {
  return /\.excalidraw(?:\?|$)/i.test(path);
}

export function parseExcalidrawJson(raw: string): ExcalidrawInitialData | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const elements = parsed.elements;
    if (!Array.isArray(elements)) return null;

    const appState = (parsed.appState || {}) as Record<string, unknown>;
    const files = (parsed.files || {}) as Record<string, unknown>;

    return {
      elements: elements as Record<string, unknown>[],
      appState: {
        ...appState,
        viewModeEnabled: true,
      },
      files,
    };
  } catch {
    return null;
  }
}
