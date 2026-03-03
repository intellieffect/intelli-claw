/**
 * media-path.ts — Media path validation and sanitization (#114)
 *
 * Validates that media file paths from external devices are accessible
 * and properly resolved via the API server.
 */

/**
 * Validate that a media path is accessible from the current device.
 * External device images are stored by the gateway on the Mac Studio,
 * so paths must be gateway-relative or served via API.
 */
export function validateMediaPath(path: string): { valid: boolean; reason?: string } {
  if (!path || typeof path !== "string") {
    return { valid: false, reason: "empty path" };
  }

  // data: URLs are always valid (inline base64)
  if (path.startsWith("data:")) {
    return { valid: true };
  }

  // HTTP(S) URLs are valid
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return { valid: true };
  }

  // Absolute paths referencing user home dirs may not be accessible
  // from remote devices — flag them (#114)
  if (path.startsWith("/") && !path.includes("/openclaw/") && !path.includes("/media/")) {
    return { valid: false, reason: "absolute path may not be accessible from remote device" };
  }

  // Relative paths and gateway media paths are valid
  return { valid: true };
}

/**
 * Resolve a media path to an accessible URL.
 * For absolute/relative filesystem paths, route through the API server.
 */
export function resolveMediaUrl(path: string, apiBase: string): string {
  if (!path) return "";

  // Already a URL — pass through
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:")) {
    return path;
  }

  // Filesystem path → serve via media API
  return `${apiBase}/api/media?path=${encodeURIComponent(path)}`;
}

/**
 * Sanitize an attachment file path to prevent directory traversal
 * and remove dangerous characters (#114).
 */
export function sanitizeAttachmentPath(rawPath: string): string {
  // Remove null bytes and control characters
  let sanitized = rawPath.replace(/[\x00-\x1f]/g, "");
  // Prevent directory traversal
  sanitized = sanitized.replace(/\.\.\//g, "");
  sanitized = sanitized.replace(/\.\.\\/g, "");
  return sanitized.trim();
}
