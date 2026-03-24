/**
 * #256 — Session-preserving reload for Electron windows.
 *
 * Extracts the reload logic so it can be tested independently
 * and reused from both menu reload and render-process-gone handler.
 */
import { join } from "path";

export interface ReloadContext {
  /** Current windowId for the target window */
  windowId: number | undefined;
  /** Map of windowId → latest sessionKey (maintained via IPC) */
  windowSessionKeys: ReadonlyMap<number, string>;
  /** ELECTRON_RENDERER_URL (dev server) or undefined (production) */
  rendererUrl: string | undefined;
  /** Absolute path to the built renderer index.html */
  rendererHtmlPath: string;
}

export type ReloadTarget =
  | { kind: "url"; url: string }
  | { kind: "file"; filePath: string; query?: Record<string, string> };

/**
 * Build the correct load target for a window reload,
 * preserving the latest session key from `windowSessionKeys`.
 */
export function buildReloadTarget(ctx: ReloadContext): ReloadTarget {
  const sessionKey =
    ctx.windowId !== undefined
      ? ctx.windowSessionKeys.get(ctx.windowId)
      : undefined;

  const sessionParam = sessionKey
    ? `session=${encodeURIComponent(sessionKey)}`
    : "";

  if (ctx.rendererUrl) {
    const separator = ctx.rendererUrl.includes("?") ? "&" : "?";
    return {
      kind: "url",
      url: sessionParam
        ? `${ctx.rendererUrl}${separator}${sessionParam}`
        : ctx.rendererUrl,
    };
  }

  if (sessionKey) {
    return {
      kind: "file",
      filePath: ctx.rendererHtmlPath,
      query: { session: sessionKey },
    };
  }

  return { kind: "file", filePath: ctx.rendererHtmlPath };
}
