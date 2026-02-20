"use client";

import { useState, useEffect, useCallback } from "react";
import { X, FileText, RefreshCw, ExternalLink, Copy, Check } from "lucide-react";

interface FileEntry {
  name: string;
  relativePath: string;
  size: number;
  modified: string;
  meta: Record<string, string>;
}

export function ShowcasePanel({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/showcase");
      const data = await res.json();
      setFiles(data.files || []);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const iframeUrl = selected ? `/api/showcase/${selected}` : null;
  const selectedFile = files.find((f) => f.relativePath === selected);

  const handleCopyContent = async () => {
    if (!iframeUrl) return;
    try {
      const res = await fetch(iframeUrl);
      const html = await res.text();
      // Copy as rich text via clipboard API
      const blob = new Blob([html], { type: "text/html" });
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": blob, "text/plain": new Blob([html], { type: "text/plain" }) }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: just copy text
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    return `${(bytes / 1024).toFixed(1)}KB`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Group files by directory
  const grouped = files.reduce<Record<string, FileEntry[]>>((acc, f) => {
    const dir = f.relativePath.includes("/")
      ? f.relativePath.split("/")[0]
      : "일반";
    if (!acc[dir]) acc[dir] = [];
    acc[dir].push(f);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm">
      {/* Sidebar - file list */}
      <div className="flex w-72 flex-col border-r border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-primary" />
            <span className="text-sm font-semibold">Showcase</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={fetchFiles}
              className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              title="새로고침"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              title="닫기 (Esc)"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              로딩 중...
            </div>
          ) : files.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              파일이 없습니다
            </div>
          ) : (
            Object.entries(grouped).map(([dir, items]) => (
              <div key={dir} className="mb-3">
                <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {dir}
                </div>
                {items.map((f) => (
                  <button
                    key={f.relativePath}
                    onClick={() => setSelected(f.relativePath)}
                    className={`w-full rounded-lg px-3 py-2.5 text-left transition ${
                      selected === f.relativePath
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <div className="truncate text-sm font-medium">
                      {f.meta.subject || f.name.replace(".html", "")}
                    </div>
                    {f.meta.to && (
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        → {f.meta.to}
                      </div>
                    )}
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      {f.meta.agent && (
                        <>
                          <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] font-medium text-primary">
                            {f.meta.agent}
                          </span>
                          <span>·</span>
                        </>
                      )}
                      <span>{formatDate(f.modified)}</span>
                      <span>·</span>
                      <span>{formatSize(f.size)}</span>
                    </div>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main content - iframe */}
      <div className="flex flex-1 flex-col bg-background">
        {selected ? (
          <>
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <div className="flex items-center gap-3 truncate">
                <span className="truncate text-sm text-muted-foreground">
                  {selectedFile?.meta.subject || selected}
                </span>
                {selectedFile?.meta.agent && (
                  <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    by {selectedFile.meta.agent}
                    {selectedFile.meta.session ? ` · ${selectedFile.meta.session}` : ""}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleCopyContent}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title="HTML 복사 (Gmail 붙여넣기용)"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copied ? "복사됨!" : "복사"}</span>
                </button>
                <a
                  href={`/api/showcase/${selected}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title="새 탭에서 열기"
                >
                  <ExternalLink size={13} />
                  <span>새 탭</span>
                </a>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <iframe
                src={`/api/showcase/${selected}`}
                className="h-full w-full border-0 bg-white"
                title="Showcase preview"
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            왼쪽에서 파일을 선택하세요
          </div>
        )}
      </div>
    </div>
  );
}
