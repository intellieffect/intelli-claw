"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Paperclip, X, FileText, Image as ImageIcon, File } from "lucide-react";

export interface ChatAttachment {
  id: string;
  file: File;
  preview?: string; // data URL for images
  type: "image" | "file";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function fileToAttachment(file: File): Promise<ChatAttachment> {
  return new Promise((resolve) => {
    const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isImage = file.type.startsWith("image/");

    if (isImage) {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          id,
          file,
          preview: reader.result as string,
          type: "image",
        });
      };
      reader.readAsDataURL(file);
    } else {
      resolve({ id, file, type: "file" });
    }
  });
}

// ---- Attachment preview bar ----

export function AttachmentPreview({
  attachments,
  onRemove,
}: {
  attachments: ChatAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-4 py-2">
      {attachments.map((att) => (
        <div
          key={att.id}
          className="group relative flex items-center gap-2 rounded-lg border border-border bg-muted p-2 text-xs text-foreground"
        >
          {att.type === "image" && att.preview ? (
            <img
              src={att.preview}
              alt={att.file.name}
              className="h-10 w-10 md:h-12 md:w-12 rounded object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded bg-muted">
              <FileText size={20} className="text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 max-w-[100px] md:max-w-[120px]">
            <div className="truncate font-medium">{att.file.name}</div>
            <div className="text-muted-foreground">{formatSize(att.file.size)}</div>
          </div>
          <button
            onClick={() => onRemove(att.id)}
            className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-muted p-0.5 text-foreground hover:bg-destructive group-hover:block"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---- Attachment button ----

export function AttachButton({
  onAttach,
}: {
  onAttach: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Detect mobile for camera capture attribute
  const isTouchDevice = typeof window !== "undefined" && "ontouchstart" in window;

  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-muted hover:text-foreground"
        title="파일 첨부"
      >
        <Paperclip size={18} />
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={isTouchDevice ? "image/*,video/*,*/*" : undefined}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            onAttach(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
      />
    </>
  );
}

// ---- Drag & drop overlay ----

export function DropZone({
  onDrop,
  children,
}: {
  onDrop: (files: File[]) => void;
  children: React.ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer?.types.includes("Files")) {
      setDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      dragCounter.current = 0;

      if (e.dataTransfer?.files?.length) {
        onDrop(Array.from(e.dataTransfer.files));
      }
    },
    [onDrop]
  );

  return (
    <div
      className="relative flex-1 flex flex-col min-h-0"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      {dragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Paperclip size={32} />
            <span className="text-sm font-medium">파일을 여기에 놓으세요</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Hook: useFileAttachments ----

export function useFileAttachments() {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  const addFiles = useCallback(async (files: File[]) => {
    const newAtts = await Promise.all(files.map(fileToAttachment));
    setAttachments((prev) => [...prev, ...newAtts]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  // Handle clipboard paste
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    },
    [addFiles]
  );

  return {
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
    handlePaste,
  };
}

/**
 * Convert a ChatAttachment to a base64 data URL for sending via gateway.
 * The gateway chat.send accepts attachments as unknown[] — we send objects
 * with {name, mimeType, data} where data is a base64 data URL.
 */
export async function attachmentToPayload(
  att: ChatAttachment
): Promise<{ fileName: string; mimeType: string; content: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Convert data URL to pure base64 (strip "data:...;base64," prefix)
      const dataUrl = reader.result as string;
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      resolve({
        fileName: att.file.name,
        mimeType: att.file.type || "application/octet-stream",
        content: base64,
      });
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(att.file);
  });
}
