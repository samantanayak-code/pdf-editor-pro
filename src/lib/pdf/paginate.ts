import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { PaginationOptions, PDFProcessingResult } from './types';

/**
 * Render every page of a PDF to PNG via pdf.js, build a fresh unencrypted
 * pdf-lib document from those bitmaps, then stamp text on top.
 * This is the only cross-browser approach that survives owner-password encryption.
 */
async function renderPdfToImageDoc(
  pdfBytes: Uint8Array,
  scale: number = 2.0
): Promise<{ newDoc: PDFDocument; pageSizes: { width: number; height: number }[] }> {
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(0) });
  const pdfJsDoc = await loadingTask.promise;
  const newDoc = await PDFDocument.create();
  const pageSizes: { width: number; height: number }[] = [];

  for (let i = 1; i <= pdfJsDoc.numPages; i++) {
    const page = await pdfJsDoc.getPage(i);
    const vp1 = page.getViewport({ scale: 1.0 });
    const vp = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    const pngDataUrl = canvas.toDataURL('image/png');
    const pngBase64 = pngDataUrl.split(',')[1];
    const pngBytes = Uint8Array.from(atob(pngBase64), c => c.charCodeAt(0));
    const pngImage = await newDoc.embedPng(pngBytes);

    const pdfPage = newDoc.addPage([vp1.width, vp1.height]);
    pdfPage.drawImage(pngImage, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    pageSizes.push({ width: vp1.width, height: vp1.height });
  }

  return { newDoc, pageSizes };
}

export async function addPageNumbers(
  pdfBuffer: ArrayBuffer,
  options: PaginationOptions
): Promise<PDFProcessingResult> {
  const {
    format,
    startNumber = 1,
    position,
    fontSize = 10,
    color = { r: 0, g: 0, b: 0 },
    excludePages = [],
    marginX = 40,
    marginY = 40,
  } = options;

  try {
    const srcBytes = new Uint8Array(pdfBuffer.slice(0));

    // Step 1: render all pages to images via pdf.js (handles encryption natively)
    const { newDoc, pageSizes } = await renderPdfToImageDoc(srcBytes, 2.0);

    // Step 2: stamp page numbers on the image-based pages
    const font = await newDoc.embedFont(StandardFonts.Helvetica);
    const pages = newDoc.getPages();
    const totalPages = pages.length;

    for (let i = 0; i < totalPages; i++) {
      if (excludePages.includes(i + 1)) continue;

      const { width, height } = pageSizes[i];
      const pageNumber = i + startNumber;
      const text = format
        .replace('{page}', pageNumber.toString())
        .replace('{total}', totalPages.toString());

      const textWidth = font.widthOfTextAtSize(text, fontSize);
      let x: number, y: number;

      if (position.includes('left')) x = marginX;
      else if (position.includes('center')) x = (width - textWidth) / 2;
      else x = width - textWidth - marginX;

      y = position.includes('header') ? height - marginY : marginY;

      pages[i].drawText(text, {
        x, y,
        size: fontSize,
        font,
        color: rgb(color.r, color.g, color.b),
      });
    }

    const pdfBytes = await newDoc.save();
    return { success: true, data: pdfBytes, pageCount: totalPages, fileSize: pdfBytes.length };
  } catch (error) {
    return {
      success: false,
      error: `Add page numbers failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
