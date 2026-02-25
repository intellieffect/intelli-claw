/**
 * Shared blob-based download utility.
 * Fetches a URL, validates the response, and triggers a browser download.
 */
export async function blobDownload(url: string, fileName: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[Download] Failed: ${res.status} ${res.statusText} — ${url}`);
      return false;
    }
    const blob = await res.blob();
    if (blob.size === 0) {
      console.warn("[Download] Empty file:", url);
      return false;
    }
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    return true;
  } catch (err) {
    console.error("[Download] Error:", err, url);
    return false;
  }
}

/** Append dl=1 to media API URLs to force download */
export function forceDownloadUrl(url: string): string {
  if (url.startsWith("/api/media") || url.includes("?path=")) {
    return url + (url.includes("?") ? "&" : "?") + "dl=1";
  }
  return url;
}
