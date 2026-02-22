"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  Check, Copy, ExternalLink, Eye, Code2, Download,
  FileText, FileAudio, FileVideo, File as FileIcon,
  FileSpreadsheet, FileCode, FileArchive,
} from "lucide-react";
import type { Components } from "react-markdown";

function copyText(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  return Promise.resolve();
}

function isUrl(s: string) {
  return /^https?:\/\/\S+$/.test(s.trim());
}

function CopyableLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1 group/link">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5"
        onClick={(e) => {
          e.preventDefault();
          copyText(href).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        title="클릭하면 복사 · 길게 누르면 열기"
      >
        {children}
        {copied
          ? <Check size={11} className="text-emerald-400 inline" />
          : <Copy size={11} className="opacity-40 group-hover/link:opacity-100 inline" />
        }
      </a>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="opacity-40 hover:opacity-100"
        title="새 탭에서 열기"
      >
        <ExternalLink size={11} />
      </a>
    </span>
  );
}

function HtmlPreview({ code }: { code: string }) {
  const [expanded, setExpanded] = useState(true);
  const [blank, setBlank] = useState(false);

  const metaEntries = Array.from(code.matchAll(/<meta\s+name=["']showcase:([^"']+)["']\s+content=["']([^"']*)["'][^>]*>/gi))
    .map((m) => ({ key: m[1], value: m[2] }));
  const iframeRef = useCallback((iframe: HTMLIFrameElement | null) => {
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(code);
    doc.close();
    const resize = () => {
      const h = doc.documentElement?.scrollHeight || doc.body?.scrollHeight || 300;
      iframe.style.height = Math.min(h + 4, 600) + "px";

      const text = (doc.body?.innerText || "").trim();
      const hasVisual = !!doc.body?.querySelector("img,svg,video,canvas,table,input,button,textarea,select,iframe");
      setBlank(!text && !hasVisual);
    };
    iframe.onload = resize;
    setTimeout(resize, 100);
    setTimeout(resize, 500);
  }, [code]);

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-700">
      <div className="flex items-center justify-between bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5">
          <Eye size={12} />
          Preview
        </span>
        <button
          onClick={() => setExpanded(e => !e)}
          className="rounded px-1.5 py-0.5 hover:bg-zinc-700 hover:text-zinc-200 transition"
        >
          {expanded ? "접기" : "펼치기"}
        </button>
      </div>
      {expanded && (
        <>
          <iframe
            ref={iframeRef}
            sandbox="allow-same-origin"
            className="w-full border-0 bg-white"
            style={{ minHeight: 100, maxHeight: 600 }}
          />
          {blank && (
            <div className="border-t border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300">
              {metaEntries.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-zinc-400">본문은 비어있지만, 아래 메타정보가 포함되어 있어요:</div>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {metaEntries.map((m) => (
                      <div key={m.key} className="truncate rounded bg-zinc-800 px-2 py-1">
                        <span className="text-zinc-500">{m.key}</span>
                        <span className="mx-1 text-zinc-600">:</span>
                        <span className="text-zinc-200">{m.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  표시할 본문이 없습니다. (meta/style 전용 코드일 수 있어요) · <span className="text-zinc-300">Code</span> 탭에서 원문을 확인하세요.
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CodeBlock({ className, children, rawChildren }: { className?: string; children: React.ReactNode; rawChildren?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const rawLang = className?.replace(/language-/g, "").replace(/hljs/g, "").trim() || "";
  const lang = rawLang.split(/\s+/)[0] || "";
  const code = extractText(rawChildren ?? children).replace(/\n$/, "");
  const isHtml = (lang === "html" || lang === "xml" || code.trimStart().startsWith("<!") || code.trimStart().startsWith("<html")) && code.includes("<");

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [code]);

  return (
    <div className="group relative my-3">
      <div className="flex items-center justify-between rounded-t-lg bg-muted px-4 py-1.5 text-xs text-muted-foreground">
        <span>{lang}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-2 py-0.5 transition hover:bg-muted hover:text-foreground"
        >
          {copied ? (
            <>
              <Check size={12} /> Copied
            </>
          ) : (
            <>
              <Copy size={12} /> Copy
            </>
          )}
        </button>
      </div>
      {(!isHtml || !showPreview) && (
        <pre className="!mt-0 !rounded-t-none">
          <code className={className}>{children}</code>
        </pre>
      )}
      {isHtml && (
        <>
          <div className="flex border-t border-zinc-700">
            <button
              onClick={() => setShowPreview(false)}
              className={`flex-1 flex items-center justify-center gap-1 px-3 py-1 text-xs transition ${!showPreview ? "bg-zinc-700 text-zinc-200" : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
            >
              <Code2 size={11} /> Code
            </button>
            <button
              onClick={() => setShowPreview(true)}
              className={`flex-1 flex items-center justify-center gap-1 px-3 py-1 text-xs transition ${showPreview ? "bg-zinc-700 text-zinc-200" : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
            >
              <Eye size={11} /> Preview
            </button>
          </div>
          {showPreview && <HtmlPreview code={code} />}
        </>
      )}
    </div>
  );
}

/** Recursively extract text from React children (handles rehype-highlight spans) */
function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return extractText((node as any).props?.children);
  }
  return "";
}

const components: Partial<Components> = {
  code({ className, children, ...props }) {
    const isInline = !className && typeof children === "string" && !children.includes("\n");
    if (isInline) {
      const text = String(children).trim();
      if (isUrl(text)) {
        return <CopyableLink href={text}><code className={className} {...props}>{children}</code></CopyableLink>;
      }
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return <CodeBlock className={className} rawChildren={children}>{children}</CodeBlock>;
  },
  a({ href, children }) {
    if (href) {
      return <CopyableLink href={href}>{children}</CopyableLink>;
    }
    return <a>{children}</a>;
  },
  table({ children }) {
    return (
      <div className="table-wrapper">
        <table>{children}</table>
      </div>
    );
  },
};

// ---- Media file type detection ----

type MediaType = "image" | "video" | "audio" | "pdf" | "code" | "text" | "spreadsheet" | "archive" | "other";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "tiff", "tif"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "avi", "mkv"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma"]);
const CODE_EXTS = new Set(["js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "sh", "sql", "rb", "php", "swift", "kt", "css", "html", "xml"]);
const SPREADSHEET_EXTS = new Set(["csv", "xls", "xlsx"]);
const ARCHIVE_EXTS = new Set(["zip", "tar", "gz", "7z", "rar"]);

function getExtension(path: string): string {
  const match = path.match(/\.(\w+)(?:\?|$)/);
  return match ? match[1].toLowerCase() : "";
}

function detectMediaType(path: string): MediaType {
  const ext = getExtension(path);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (CODE_EXTS.has(ext)) return "code";
  if (SPREADSHEET_EXTS.has(ext)) return "spreadsheet";
  if (ARCHIVE_EXTS.has(ext)) return "archive";
  if (["txt", "md", "log", "json", "yaml", "yml"].includes(ext)) return "text";
  return "other";
}

function getFileName(path: string): string {
  // Handle both URL-encoded API paths and raw paths
  const decoded = decodeURIComponent(path);
  const parts = decoded.split("/");
  const last = parts[parts.length - 1];
  // Remove query params
  return last.split("?")[0] || "file";
}

function renderMediaTypeIcon(type: MediaType, size: number) {
  switch (type) {
    case "audio": return <FileAudio size={size} />;
    case "video": return <FileVideo size={size} />;
    case "pdf": return <FileText size={size} />;
    case "code": return <FileCode size={size} />;
    case "spreadsheet": return <FileSpreadsheet size={size} />;
    case "archive": return <FileArchive size={size} />;
    case "text": return <FileText size={size} />;
    default: return <FileIcon size={size} />;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Extract original file path from MEDIA: URL for info API */
function extractOriginalPath(url: string): string | null {
  try {
    const match = url.match(/[?&]path=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/** Extract MEDIA: lines and return [cleanedContent, mediaEntries[]] */
interface MediaEntry {
  url: string;
  originalPath: string;
  type: MediaType;
  fileName: string;
}

function extractMediaLines(text: string): [string, MediaEntry[]] {
  const entries: MediaEntry[] = [];
  // Only match MEDIA: lines with actual file paths (starting with /) or URLs
  const cleaned = text.replace(/^MEDIA:\s*(.+)$/gm, (_match, path: string) => {
    const trimmed = path.trim();
    // Allow absolute paths, URLs, data URIs, and relative paths with file extensions
    const hasExt = /\.\w{2,5}$/.test(trimmed);
    if (!trimmed.startsWith("/") && !trimmed.startsWith("http://") && !trimmed.startsWith("https://") && !trimmed.startsWith("data:") && !hasExt) {
      return _match; // Leave as-is, not a real MEDIA marker
    }
    let url: string;
    let originalPath: string;

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:")) {
      url = trimmed;
      originalPath = trimmed;
    } else {
      url = `/api/media?path=${encodeURIComponent(trimmed)}`;
      originalPath = trimmed;
    }

    const type = detectMediaType(trimmed);
    const fileName = getFileName(trimmed);
    entries.push({ url, originalPath, type, fileName });
    return "";
  });
  return [cleaned, entries];
}

// ---- Media renderers ----

function MediaImage({ src }: { src: string }) {
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (error) {
    return (
      <div className="flex h-48 w-48 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/50 text-xs text-zinc-500">
        ⚠️ 로드 실패
      </div>
    );
  }

  return (
    <img
      src={src}
      alt="media"
      className={`rounded-lg border border-zinc-700 cursor-pointer transition-all ${expanded ? "max-w-full" : "h-48 max-w-xs md:h-56 md:max-w-sm"} object-contain`}
      onClick={() => setExpanded(e => !e)}
      onError={() => setError(true)}
    />
  );
}

function MediaVideo({ src }: { src: string }) {
  return (
    <video
      src={src}
      controls
      className="h-48 md:h-56 rounded-lg border border-zinc-700"
      preload="metadata"
    />
  );
}

function MediaAudio({ src, fileName }: { src: string; fileName: string }) {
  return (
    <div className="flex w-64 items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800/80 p-3">
      <FileAudio size={20} className="shrink-0 text-zinc-400" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-zinc-200">{fileName}</div>
        <audio src={src} controls className="mt-1.5 w-full" preload="metadata" />
      </div>
    </div>
  );
}

function MediaPdf({ src, fileName }: { src: string; fileName: string }) {
  return (
    <div className="w-72 overflow-hidden rounded-lg border border-zinc-700">
      <object
        data={src}
        type="application/pdf"
        className="h-48 md:h-56 w-full"
      >
        <FileCard url={src} fileName={fileName} type="pdf" />
      </object>
    </div>
  );
}

/** Get accent color by media type */
function getMediaAccent(type: MediaType): string {
  switch (type) {
    case "pdf": return "bg-red-500/20 text-red-400";
    case "image": return "bg-blue-500/20 text-blue-400";
    case "video": return "bg-purple-500/20 text-purple-400";
    case "audio": return "bg-green-500/20 text-green-400";
    case "spreadsheet": return "bg-emerald-500/20 text-emerald-400";
    case "archive": return "bg-yellow-500/20 text-yellow-400";
    case "code": return "bg-cyan-500/20 text-cyan-400";
    default: return "bg-zinc-500/20 text-zinc-400";
  }
}

/** Blob-based download */
async function blobDownload(url: string, name: string) {
  try {
    const dlUrl = url.startsWith("/api/media") ? url + (url.includes("?") ? "&" : "?") + "dl=1" : url;
    const res = await fetch(dlUrl);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, "_blank");
  }
}

function FileCard({ url, fileName, type }: { url: string; fileName: string; type: MediaType }) {
  const [fileInfo, setFileInfo] = useState<{ size: number } | null>(null);
  const accent = getMediaAccent(type);
  const ext = getExtension(fileName);
  const nameWithoutExt = ext ? fileName.slice(0, -(ext.length + 1)) : fileName;
  const maxLen = 18;
  const displayName = nameWithoutExt.length > maxLen ? nameWithoutExt.slice(0, maxLen) + "…" : nameWithoutExt;

  useEffect(() => {
    const originalPath = extractOriginalPath(url);
    if (!originalPath) return;
    fetch(`/api/media?path=${encodeURIComponent(originalPath)}&info=1`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.size) setFileInfo({ size: data.size }); })
      .catch(() => {});
  }, [url]);

  return (
    <button
      onClick={() => blobDownload(url, fileName)}
      className="flex w-44 flex-col items-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-800/60 p-4 transition hover:bg-zinc-700/60 hover:border-zinc-600 cursor-pointer group"
    >
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${accent}`}>
        {renderMediaTypeIcon(type, 24)}
      </div>
      <div className="w-full text-center min-w-0">
        <div className="text-xs font-medium text-zinc-200 truncate" title={fileName}>
          {displayName}
        </div>
        <div className="flex items-center justify-center gap-1 mt-0.5">
          {ext && <span className="text-[10px] text-zinc-500 uppercase">.{ext}</span>}
          {fileInfo && <span className="text-[10px] text-zinc-600">· {formatFileSize(fileInfo.size)}</span>}
        </div>
      </div>
      <Download size={14} className="text-zinc-500 group-hover:text-zinc-300 transition" />
    </button>
  );
}

function MediaRenderer({ entry }: { entry: MediaEntry }) {
  switch (entry.type) {
    case "image":
      return <MediaImage src={entry.url} />;
    case "video":
      return <MediaVideo src={entry.url} />;
    case "audio":
      return <MediaAudio src={entry.url} fileName={entry.fileName} />;
    case "pdf":
      return <MediaPdf src={entry.url} fileName={entry.fileName} />;
    default:
      return <FileCard url={entry.url} fileName={entry.fileName} type={entry.type} />;
  }
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
}: {
  content: string;
}) {
  // Extract MEDIA: lines
  const [withoutMedia, mediaEntries] = extractMediaLines(content);
  // Collapse 3+ consecutive newlines to 2 (one blank line)
  const cleaned = withoutMedia.replace(/\n{3,}/g, "\n\n").trim();
  return (
    <div className="prose">
      {mediaEntries.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
          {mediaEntries.map((entry, i) => (
            <div key={i} className="shrink-0">
              <MediaRenderer entry={entry} />
            </div>
          ))}
        </div>
      )}
      {cleaned && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={components}
        >
          {cleaned}
        </ReactMarkdown>
      )}
    </div>
  );
});
