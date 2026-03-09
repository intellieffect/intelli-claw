
import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, FileText, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import type { ToolCall } from "@/lib/gateway/protocol";
import { SubagentCard, type SpawnAttachment, type SpawnReceipt } from "./subagent-card";

/** Tools that spawn subagents */
const SPAWN_TOOLS = new Set(["sessions_spawn", "subagents"]);

/** Tools for PDF analysis */
const PDF_TOOLS = new Set(["pdf"]);

export function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  // Extract subagent info from sessions_spawn args/result
  const spawnInfo = useMemo(() => {
    if (!SPAWN_TOOLS.has(toolCall.name)) return null;
    try {
      const args = toolCall.args ? JSON.parse(toolCall.args) : {};
      let result: Record<string, unknown> = {};
      try { result = toolCall.result ? JSON.parse(toolCall.result) : {}; } catch {}
      const rawAttachments = args.attachments as Array<{ name: string; mimeType?: string }> | undefined;
      const attachments: SpawnAttachment[] | undefined = rawAttachments?.map((a) => ({
        name: a.name,
        mimeType: a.mimeType,
      }));
      const rawReceipts = (result.receipts as Array<{ name: string; sha256: string }>) || undefined;
      const receipts: SpawnReceipt[] | undefined = rawReceipts?.map((r) => ({
        name: r.name,
        sha256: r.sha256,
      }));
      return {
        sessionKey: (result.childSessionKey || result.sessionKey || result.key || undefined) as string | undefined,
        label: (args.label || result.label || undefined) as string | undefined,
        task: (args.task || args.message || undefined) as string | undefined,
        attachments,
        receipts,
      };
    } catch {
      // Even if parsing fails, still show the card for spawn tools
      return { sessionKey: undefined, label: undefined, task: undefined, attachments: undefined, receipts: undefined };
    }
  }, [toolCall.name, toolCall.args, toolCall.result]);

  // If this is a spawn tool, render SubagentCard instead
  if (spawnInfo) {
    return (
      <SubagentCard
        sessionKey={spawnInfo.sessionKey}
        label={spawnInfo.label}
        task={spawnInfo.task}
        attachments={spawnInfo.attachments}
        receipts={spawnInfo.receipts}
      />
    );
  }

  // PDF tool: specialized card
  if (PDF_TOOLS.has(toolCall.name)) {
    return <PdfToolCard toolCall={toolCall} />;
  }

  const statusIcon =
    toolCall.status === "running" ? (
      <Loader2 size={14} className="animate-spin text-primary" />
    ) : toolCall.status === "done" ? (
      <CheckCircle2 size={14} className="text-emerald-400" />
    ) : (
      <AlertCircle size={14} className="text-destructive" />
    );

  return (
    <div className="my-1.5 rounded-lg border border-border bg-muted/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-muted"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {statusIcon}
        <span className="font-mono text-xs text-foreground">{toolCall.name}</span>
        {toolCall.status === "running" && (
          <span className="ml-auto text-xs text-muted-foreground">실행 중...</span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2 text-xs">
          {toolCall.args && (
            <div className="mb-2">
              <div className="mb-1 text-muted-foreground">Arguments</div>
              <pre className="max-h-40 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all rounded bg-background p-2 text-muted-foreground">
                {formatJson(toolCall.args)}
              </pre>
            </div>
          )}
          {toolCall.result && (
            <div>
              <div className="mb-1 text-muted-foreground">Result</div>
              <pre className="max-h-40 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all rounded bg-background p-2 text-muted-foreground">
                {formatJson(toolCall.result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Extract filename from a path or URL */
function pdfFileName(ref: string): string {
  try {
    const url = new URL(ref);
    return url.pathname.split("/").pop() || ref;
  } catch {
    return ref.split("/").pop() || ref;
  }
}

function PdfToolCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const pdfInfo = useMemo(() => {
    try {
      const args = toolCall.args ? JSON.parse(toolCall.args) : {};
      let result: Record<string, unknown> | null = null;
      try { result = toolCall.result ? JSON.parse(toolCall.result) : null; } catch {}

      const singlePdf = args.pdf as string | undefined;
      const multiPdfs = args.pdfs as string[] | undefined;
      const files = multiPdfs || (singlePdf ? [singlePdf] : []);

      const prompt = (args.prompt as string) || undefined;
      const pages = (args.pages as string) || undefined;

      // Parse result
      let resultText: string | undefined;
      let native: boolean | undefined;
      let model: string | undefined;
      let error: string | undefined;

      if (result) {
        const content = result.content as Array<{ text: string }> | undefined;
        resultText = content?.[0]?.text;
        const details = result.details as Record<string, unknown> | undefined;
        if (details) {
          native = details.native as boolean | undefined;
          model = details.model as string | undefined;
        }
        const err = result.error as Record<string, unknown> | undefined;
        if (err) {
          error = (err.message as string) || (err.code as string);
        }
      }

      return { files, prompt, pages, resultText, native, model, error };
    } catch {
      return { files: [], prompt: undefined, pages: undefined, resultText: undefined, native: undefined, model: undefined, error: undefined };
    }
  }, [toolCall.args, toolCall.result]);

  const statusIcon =
    toolCall.status === "running" ? (
      <Loader2 size={14} className="animate-spin text-primary" />
    ) : toolCall.status === "done" ? (
      <CheckCircle2 size={14} className="text-emerald-400" />
    ) : (
      <AlertCircle size={14} className="text-destructive" />
    );

  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-border/50 bg-muted/30">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-muted/50"
      >
        {statusIcon}
        <FileText size={14} className="text-red-400" />
        <span className="flex-1 truncate text-xs font-medium text-foreground">
          {pdfInfo.files.length > 1
            ? pdfInfo.files.map(pdfFileName).join(", ")
            : pdfInfo.files.length === 1
              ? pdfFileName(pdfInfo.files[0])
              : "PDF"}
        </span>
        {pdfInfo.pages && (
          <span className="text-[10px] text-muted-foreground">
            pp. {pdfInfo.pages}
          </span>
        )}
        {expanded ? (
          <ChevronDown size={12} className="text-muted-foreground" />
        ) : (
          <ChevronRight size={12} className="text-muted-foreground" />
        )}
      </button>

      {/* Prompt preview when collapsed */}
      {!expanded && pdfInfo.prompt && (
        <div className="border-t border-border/30 px-3 py-1.5">
          <p className="truncate text-[11px] text-muted-foreground">
            {pdfInfo.prompt}
          </p>
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border/30 px-3 py-2 text-[11px]">
          {/* File list for multi-PDF */}
          {pdfInfo.files.length > 1 && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-medium text-muted-foreground">Files</div>
              {pdfInfo.files.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
                  <FileText size={12} />
                  <span>{pdfFileName(f)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Prompt */}
          {pdfInfo.prompt && (
            <div className="mb-2 text-muted-foreground">
              <span className="font-medium">Prompt: </span>
              {pdfInfo.prompt}
            </div>
          )}

          {/* Result */}
          {pdfInfo.resultText && (
            <div className="mb-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[10px] font-medium text-muted-foreground">Result</span>
                {pdfInfo.native != null && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                    pdfInfo.native
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-amber-500/10 text-amber-500"
                  }`}>
                    {pdfInfo.native ? "Native" : "Extraction"}
                  </span>
                )}
                {pdfInfo.model && (
                  <span className="text-[9px] text-muted-foreground font-mono">
                    {pdfInfo.model}
                  </span>
                )}
              </div>
              <pre className="max-h-48 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all rounded bg-background p-2 text-muted-foreground font-mono">
                {pdfInfo.resultText}
              </pre>
            </div>
          )}

          {/* Error */}
          {pdfInfo.error && (
            <div className="text-destructive">
              {pdfInfo.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
