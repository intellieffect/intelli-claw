export interface MediaInfo {
  fileName: string;
  size: number;
  mimeType: string;
  extension: string;
  modifiedAt: string;
}

export interface ShowcaseFileEntry {
  name: string;
  relativePath: string;
  size: number;
  modified: string;
  meta: Record<string, string>;
}

export interface PlatformAPI {
  /** Build a URL to serve a media file (for <img src>, <video src>, etc.) */
  mediaUrl(filePath: string, opts?: { dl?: boolean; info?: boolean }): string;

  /** Fetch media file info (metadata only) */
  mediaGetInfo(filePath: string): Promise<MediaInfo>;

  /** List showcase HTML files */
  showcaseList(): Promise<{ files: ShowcaseFileEntry[] }>;

  /** Build a URL to serve a showcase file */
  showcaseUrl(relativePath: string): string;

  /** Upload an image (base64) for permanent server-side storage (#110) */
  mediaUpload?(data: string, mimeType: string, fileName?: string): Promise<{ path: string }>;
}
