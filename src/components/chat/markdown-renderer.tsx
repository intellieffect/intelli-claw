"use client";

import { memo, useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, ExternalLink, Eye, Code2 } from "lucide-react";
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
    // Auto-resize + blank detection
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
};

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
}: {
  content: string;
}) {
  // Collapse 3+ consecutive newlines to 2 (one blank line)
  const cleaned = content.replace(/\n{3,}/g, "\n\n");
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
});
