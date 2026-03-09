import * as pdfjsLib from "pdfjs-dist";

// Worker served from public/ (copied from pdfjs-dist v4 build/)
pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdf.worker.min.mjs";

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Render a PDF page to JPEG base64. */
async function renderPageToJpeg(
  page: pdfjsLib.PDFPageProxy,
  scale: number,
  quality: number,
): Promise<string> {
  const viewport = page.getViewport({ scale });
  const w = Math.round(viewport.width);
  const h = Math.round(viewport.height);

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    return blobToBase64(blob);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return dataUrl.split(",")[1];
}

/** First-page thumbnail as data URL for the attachment preview bar. */
export async function extractPdfPreview(file: File): Promise<string | undefined> {
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const base64 = await renderPageToJpeg(page, 0.5, 0.6);
    return `data:image/jpeg;base64,${base64}`;
  } catch {
    return undefined;
  }
}
